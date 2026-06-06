/**
 * Rate Limit Management
 *
 * Handles rate limit tracking and state management for accounts.
 * All rate limits are model-specific.
 */

import { DEFAULT_COOLDOWN_MS } from '../constants.js';
import { formatDuration } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

/**
 * Check if all accounts are rate-limited for a specific model
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model ID to check rate limits for
 * @returns {boolean} True if all accounts are rate-limited
 */
export function isAllRateLimited(accounts, modelId) {
    const enabledAccounts = accounts.filter(acc => !acc.isDisabled && !acc.isInvalid);
    if (enabledAccounts.length === 0) return true;
    if (!modelId) return false; // No model specified = not rate limited

    return enabledAccounts.every(acc => {
        const modelLimits = acc.modelRateLimits || {};
        const limit = modelLimits[modelId];
        return limit && limit.isRateLimited && limit.resetTime > Date.now();
    });
}

/**
 * Get list of available (non-rate-limited, non-invalid) accounts for a model
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} [modelId] - Model ID to filter by
 * @returns {Array} Array of available account objects
 */
export function getAvailableAccounts(accounts, modelId = null) {
    return accounts.filter(acc => {
        if (acc.isDisabled) return false;
        if (acc.isInvalid) return false;

        if (modelId && acc.modelRateLimits && acc.modelRateLimits[modelId]) {
            const limit = acc.modelRateLimits[modelId];
            if (limit.isRateLimited && limit.resetTime > Date.now()) {
                return false;
            }
        }

        return true;
    });
}

/**
 * Get list of invalid accounts
 *
 * @param {Array} accounts - Array of account objects
 * @returns {Array} Array of invalid account objects
 */
export function getInvalidAccounts(accounts) {
    return accounts.filter(acc => acc.isInvalid);
}

/**
 * Clear expired rate limits
 *
 * @param {Array} accounts - Array of account objects
 * @returns {number} Number of rate limits cleared
 */
export function clearExpiredLimits(accounts) {
    const now = Date.now();
    let cleared = 0;

    for (const account of accounts) {
        if (account.modelRateLimits) {
            for (const [modelId, limit] of Object.entries(account.modelRateLimits)) {
                if (limit.isRateLimited && limit.resetTime <= now) {
                    limit.isRateLimited = false;
                    limit.resetTime = null;
                    cleared++;
                    logger.success(`[AccountManager] Rate limit expired for: ${account.email} (model: ${modelId})`);
                }
            }
        }
    }

    return cleared;
}

/**
 * Clear all rate limits to force a fresh check (optimistic retry strategy)
 *
 * @param {Array} accounts - Array of account objects
 */
export function resetAllRateLimits(accounts) {
    for (const account of accounts) {
        if (account.modelRateLimits) {
            for (const key of Object.keys(account.modelRateLimits)) {
                account.modelRateLimits[key] = { isRateLimited: false, resetTime: null };
            }
        }
    }
    logger.warn('[AccountManager] Reset all rate limits for optimistic retry');
}

/**
 * Mark an account as rate-limited for a specific model
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Email of the account to mark
 * @param {number|null} resetMs - Time in ms until rate limit resets
 * @param {Object} settings - Settings object with cooldownDurationMs
 * @param {string} modelId - Model ID to mark rate limit for
 * @returns {boolean} True if account was found and marked
 */
export function markRateLimited(accounts, email, resetMs = null, settings = {}, modelId) {
    const account = accounts.find(a => a.email === email);
    if (!account) return false;

    const cooldownMs = resetMs || settings.cooldownDurationMs || DEFAULT_COOLDOWN_MS;
    const resetTime = Date.now() + cooldownMs;

    if (!account.modelRateLimits) {
        account.modelRateLimits = {};
    }

    account.modelRateLimits[modelId] = {
        isRateLimited: true,
        resetTime: resetTime,
        limitedAt: Date.now()
    };

    if (account.cachedModelQuotas && modelId) {
        account.cachedModelQuotas[modelId] = {
            remainingFraction: 0,
            resetTime: new Date(resetTime).toISOString()
        };
        account.cachedModelQuotasAt = Date.now();
    }

    account.isDisabled = true;
    account.disabledReason = 'quota_exhausted';
    account.disabledAt = Date.now();

    logger.warn(
        `[AccountManager] Rate limited: ${email} (model: ${modelId}). Available in ${formatDuration(cooldownMs)}`
    );
    logger.warn(`[AccountManager] Auto-disabled account for this runtime: ${email}`);

    return true;
}

/**
 * Mark an account as invalid (credentials need re-authentication)
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} email - Email of the account to mark
 * @param {string} reason - Reason for marking as invalid
 * @returns {boolean} True if account was found and marked
 */
export function markInvalid(accounts, email, reason = 'Unknown error') {
    const account = accounts.find(a => a.email === email);
    if (!account) return false;

    account.isInvalid = true;
    account.invalidReason = reason;
    account.invalidAt = Date.now();

    logger.error(
        `[AccountManager] ⚠ Account INVALID: ${email}`
    );
    logger.error(
        `[AccountManager]   Reason: ${reason}`
    );
    logger.error(
        `[AccountManager]   Run 'npm run accounts' to re-authenticate this account`
    );

    return true;
}

/**
 * Get the minimum wait time until any account becomes available for a model
 *
 * @param {Array} accounts - Array of account objects
 * @param {string} modelId - Model ID to check
 * @returns {number} Wait time in milliseconds
 */
export function getMinWaitTimeMs(accounts, modelId) {
    if (!isAllRateLimited(accounts, modelId)) return 0;

    const now = Date.now();
    let minWait = Infinity;
    let soonestAccount = null;

    for (const account of accounts) {
        if (account.isDisabled || account.isInvalid) continue;

        if (modelId && account.modelRateLimits && account.modelRateLimits[modelId]) {
            const limit = account.modelRateLimits[modelId];
            if (limit.isRateLimited && limit.resetTime) {
                const wait = limit.resetTime - now;
                if (wait > 0 && wait < minWait) {
                    minWait = wait;
                    soonestAccount = account;
                }
            }
        }
    }

    if (soonestAccount) {
        logger.info(`[AccountManager] Shortest wait: ${formatDuration(minWait)} (account: ${soonestAccount.email})`);
    }

    return minWait === Infinity ? DEFAULT_COOLDOWN_MS : minWait;
}
