/**
 * Account Manager
 * Manages multiple Antigravity accounts with sticky selection,
 * automatic failover, and smart cooldown for rate-limited accounts.
 */

import { ACCOUNT_CONFIG_PATH } from '../constants.js';
import { loadAccounts, loadDefaultAccount, saveAccounts } from './storage.js';
import {
    isAllRateLimited as checkAllRateLimited,
    getAvailableAccounts as getAvailable,
    getInvalidAccounts as getInvalid,
    clearExpiredLimits as clearLimits,
    resetAllRateLimits as resetLimits,
    markRateLimited as markLimited,
    markInvalid as markAccountInvalid,
    getMinWaitTimeMs as getMinWait
} from './rate-limits.js';
import {
    getTokenForAccount as fetchToken,
    getProjectForAccount as fetchProject,
    clearProjectCache as clearProject,
    clearTokenCache as clearToken
} from './credentials.js';
import {
    pickNext as selectNext,
    getCurrentStickyAccount as getSticky,
    shouldWaitForCurrentAccount as shouldWait,
    pickStickyAccount as selectSticky
} from './selection.js';
import { logger } from '../utils/logger.js';

function hasModelQuota(account, modelId) {
    if (!modelId || !account?.cachedModelQuotas?.[modelId]) return false;
    const quota = account.cachedModelQuotas[modelId];
    return typeof quota.remainingFraction === 'number' && quota.remainingFraction > 0;
}

export class AccountManager {
    #accounts = [];
    #currentIndex = 0;
    #configPath;
    #settings = {};
    #initialized = false;

    // Per-account caches
    #tokenCache = new Map(); // email -> { token, extractedAt }
    #projectCache = new Map(); // email -> projectId

    constructor(configPath = ACCOUNT_CONFIG_PATH) {
        this.#configPath = configPath;
    }

    /**
     * Initialize the account manager by loading config
     */
    async initialize() {
        if (this.#initialized) return;

        const { accounts, settings, activeIndex } = await loadAccounts(this.#configPath);

        this.#accounts = accounts;
        this.#settings = settings;
        this.#currentIndex = activeIndex;

        // If config exists but has no accounts, fall back to Antigravity database
        if (this.#accounts.length === 0) {
            logger.warn('[AccountManager] No accounts in config. Falling back to Antigravity database');
            const { accounts: defaultAccounts, tokenCache } = loadDefaultAccount();
            this.#accounts = defaultAccounts;
            this.#tokenCache = tokenCache;
        }

        // Clear any expired rate limits
        this.clearExpiredLimits();

        this.#initialized = true;
    }

    /**
     * Get the number of accounts
     * @returns {number} Number of configured accounts
     */
    getAccountCount() {
        return this.#accounts.length;
    }

    /**
     * Get the number of accounts eligible for automatic selection.
     * @returns {number} Number of non-disabled, non-invalid accounts
     */
    getEnabledAccountCount() {
        return this.#accounts.filter(account => !account.isDisabled && !account.isInvalid).length;
    }

    /**
     * Check if all accounts are rate-limited
     * @param {string} [modelId] - Optional model ID
     * @returns {boolean} True if all accounts are rate-limited
     */
    isAllRateLimited(modelId = null) {
        return checkAllRateLimited(this.#accounts, modelId);
    }

    /**
     * Get list of available (non-rate-limited, non-invalid) accounts
     * @param {string} [modelId] - Optional model ID
     * @returns {Array<Object>} Array of available account objects
     */
    getAvailableAccounts(modelId = null) {
        return getAvailable(this.#accounts, modelId);
    }

    /**
     * Get list of invalid accounts
     * @returns {Array<Object>} Array of invalid account objects
     */
    getInvalidAccounts() {
        return getInvalid(this.#accounts);
    }

    /**
     * Clear expired rate limits
     * @returns {number} Number of rate limits cleared
     */
    clearExpiredLimits() {
        const cleared = clearLimits(this.#accounts);
        if (cleared > 0) {
            this.saveToDisk();
        }
        return cleared;
    }

    /**
     * Clear all rate limits to force a fresh check
     * (Optimistic retry strategy)
     * @returns {void}
     */
    resetAllRateLimits() {
        resetLimits(this.#accounts);
    }

    /**
     * Pick the next available account (fallback when current is unavailable).
     * Sets activeIndex to the selected account's index.
     * @param {string} [modelId] - Optional model ID
     * @returns {Object|null} The next available account or null if none available
     */
    pickNext(modelId = null) {
        const { account, newIndex } = selectNext(this.#accounts, this.#currentIndex, () => this.saveToDisk(), modelId);
        this.#currentIndex = newIndex;
        return account;
    }

    /**
     * Get the current account without advancing the index (sticky selection).
     * Used for cache continuity - sticks to the same account until rate-limited.
     * @param {string} [modelId] - Optional model ID
     * @returns {Object|null} The current account or null if unavailable/rate-limited
     */
    getCurrentStickyAccount(modelId = null) {
        const { account, newIndex } = getSticky(this.#accounts, this.#currentIndex, () => this.saveToDisk(), modelId);
        this.#currentIndex = newIndex;
        return account;
    }

    /**
     * Check if we should wait for the current account's rate limit to reset.
     * Used for sticky account selection - wait if rate limit is short (≤ threshold).
     * @param {string} [modelId] - Optional model ID
     * @returns {{shouldWait: boolean, waitMs: number, account: Object|null}}
     */
    shouldWaitForCurrentAccount(modelId = null) {
        return shouldWait(this.#accounts, this.#currentIndex, modelId);
    }

    /**
     * Pick an account with sticky selection preference.
     * Prefers the current account for cache continuity, only switches when:
     * - Current account is rate-limited for > 2 minutes
     * - Current account is invalid
     * @param {string} [modelId] - Optional model ID
     * @returns {{account: Object|null, waitMs: number}} Account to use and optional wait time
     */
    pickStickyAccount(modelId = null) {
        const { account, waitMs, newIndex } = selectSticky(this.#accounts, this.#currentIndex, () => this.saveToDisk(), modelId);
        this.#currentIndex = newIndex;
        return { account, waitMs };
    }

    /**
     * Mark an account as rate-limited
     * @param {string} email - Email of the account to mark
     * @param {number|null} resetMs - Time in ms until rate limit resets (optional)
     * @param {string} [modelId] - Optional model ID to mark specific limit
     */
    markRateLimited(email, resetMs = null, modelId = null) {
        markLimited(this.#accounts, email, resetMs, this.#settings, modelId);
        this.saveToDisk();
    }

    /**
     * Cache quota API results for an account and clear stale local rate limits
     * when the quota API says the account has capacity again.
     * @param {string} email - Email of the account to update
     * @param {Object} quotas - Map of modelId -> quota info
     * @returns {boolean} True if any stale rate-limit flag was cleared
     */
    updateModelQuotas(email, quotas = {}) {
        const account = this.#accounts.find(a => a.email === email);
        if (!account) return false;

        account.cachedModelQuotas = quotas;
        account.cachedModelQuotasAt = Date.now();

        let cleared = false;
        if (account.modelRateLimits) {
            for (const [modelId, limit] of Object.entries(account.modelRateLimits)) {
                if (limit?.isRateLimited && hasModelQuota(account, modelId)) {
                    limit.isRateLimited = false;
                    limit.resetTime = null;
                    cleared = true;
                    logger.success(`[AccountManager] Cleared stale rate limit from quota API: ${email} (model: ${modelId})`);
                }
            }
        }

        this.saveToDisk();
        return cleared;
    }

    /**
     * Return accounts whose cached quota API result says the model has capacity.
     * @param {string} modelId - Model ID to check
     * @returns {Array<Object>} Accounts with cached positive quota for the model
     */
    getAccountsWithCachedQuota(modelId) {
        return this.#accounts.filter(account => !account.isInvalid && hasModelQuota(account, modelId));
    }

    /**
     * Mark an account as invalid (credentials need re-authentication)
     * @param {string} email - Email of the account to mark
     * @param {string} reason - Reason for marking as invalid
     */
    markInvalid(email, reason = 'Unknown error') {
        markAccountInvalid(this.#accounts, email, reason);
        this.saveToDisk();
    }

    /**
     * Disable an account from automatic selection.
     * @param {string} email - Email of the account to disable
     * @param {string} reason - Reason for disabling
     * @returns {boolean} True if account was found
     */
    disableAccount(email, reason = 'Manually disabled') {
        const account = this.#accounts.find(a => a.email === email);
        if (!account) return false;
        account.isDisabled = true;
        account.disabledReason = reason;
        account.disabledAt = Date.now();
        logger.warn(`[AccountManager] Disabled account: ${email} (${reason})`);
        this.saveToDisk();
        return true;
    }

    /**
     * Enable a previously disabled account and clear its local rate-limit state.
     * @param {string} email - Email of the account to enable
     * @returns {boolean} True if account was found
     */
    enableAccount(email) {
        const account = this.#accounts.find(a => a.email === email);
        if (!account) return false;
        account.isDisabled = false;
        account.disabledReason = null;
        account.disabledAt = null;
        account.modelRateLimits = {};
        logger.success(`[AccountManager] Enabled account: ${email}`);
        this.saveToDisk();
        return true;
    }

    /**
     * Get the minimum wait time until any account becomes available
     * @param {string} [modelId] - Optional model ID
     * @returns {number} Wait time in milliseconds
     */
    getMinWaitTimeMs(modelId = null) {
        return getMinWait(this.#accounts, modelId);
    }

    /**
     * Get OAuth token for an account
     * @param {Object} account - Account object with email and credentials
     * @returns {Promise<string>} OAuth access token
     * @throws {Error} If token refresh fails
     */
    async getTokenForAccount(account) {
        return fetchToken(
            account,
            this.#tokenCache,
            (email, reason) => this.markInvalid(email, reason),
            () => this.saveToDisk()
        );
    }

    /**
     * Get project ID for an account
     * @param {Object} account - Account object
     * @param {string} token - OAuth access token
     * @returns {Promise<string>} Project ID
     */
    async getProjectForAccount(account, token) {
        return fetchProject(account, token, this.#projectCache);
    }

    /**
     * Clear project cache for an account (useful on auth errors)
     * @param {string|null} email - Email to clear cache for, or null to clear all
     */
    clearProjectCache(email = null) {
        clearProject(this.#projectCache, email);
    }

    /**
     * Clear token cache for an account (useful on auth errors)
     * @param {string|null} email - Email to clear cache for, or null to clear all
     */
    clearTokenCache(email = null) {
        clearToken(this.#tokenCache, email);
    }

    /**
     * Save current state to disk (async)
     * @returns {Promise<void>}
     */
    async saveToDisk() {
        await saveAccounts(this.#configPath, this.#accounts, this.#settings, this.#currentIndex);
    }

    /**
     * Get status object for logging/API
     * @returns {{accounts: Array, settings: Object}} Status object with accounts and settings
     */
    getStatus() {
        const available = this.getAvailableAccounts();
        const invalid = this.getInvalidAccounts();
        const disabled = this.#accounts.filter(a => a.isDisabled);

        // Count accounts that have any active model-specific rate limits
        const rateLimited = this.#accounts.filter(a => {
            if (a.isDisabled) return false;
            if (!a.modelRateLimits) return false;
            return Object.values(a.modelRateLimits).some(
                limit => limit.isRateLimited && limit.resetTime > Date.now()
            );
        });

        return {
            total: this.#accounts.length,
            available: available.length,
            rateLimited: rateLimited.length,
            invalid: invalid.length,
            disabled: disabled.length,
            summary: `${this.#accounts.length} total, ${available.length} available, ${rateLimited.length} rate-limited, ${invalid.length} invalid, ${disabled.length} disabled`,
            accounts: this.#accounts.map(a => ({
                email: a.email,
                source: a.source,
                modelRateLimits: a.modelRateLimits || {},
                cachedModelQuotas: a.cachedModelQuotas || {},
                cachedModelQuotasAt: a.cachedModelQuotasAt || null,
                isInvalid: a.isInvalid || false,
                invalidReason: a.invalidReason || null,
                isDisabled: a.isDisabled || false,
                disabledReason: a.disabledReason || null,
                disabledAt: a.disabledAt || null,
                lastUsed: a.lastUsed
            }))
        };
    }

    /**
     * Get settings
     * @returns {Object} Current settings object
     */
    getSettings() {
        return { ...this.#settings };
    }

    /**
     * Get all accounts (internal use for quota fetching)
     * Returns the full account objects including credentials
     * @returns {Array<Object>} Array of account objects
     */
    getAllAccounts() {
        return this.#accounts;
    }
}

export default AccountManager;
