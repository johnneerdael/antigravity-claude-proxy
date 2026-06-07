/**
 * Call Logger - CRUD and analytics queries for api_calls table.
 * All functions are synchronous (better-sqlite3).
 */

import { db } from './index.js';

// ── Prepared statements ────────────────────────────────────────────────────

const stmtInsert = db.prepare(`
  INSERT INTO api_calls
    (timestamp, date, hour, endpoint, model, account, stream,
     status, input_tokens, output_tokens, total_tokens,
     cache_read_tokens, cache_creation_tokens,
     duration_ms, error_type, error_message,
     request_system_len, request_messages, request_tools, request_chars,
    optimized, response_output_chars, response_hash,
    request_hash_before_opt, request_hash_after_opt,
    optimizer_saved_chars, optimizer_saved_messages)
  VALUES
    (@timestamp, @date, @hour, @endpoint, @model, @account, @stream,
     @status, @inputTokens, @outputTokens, @totalTokens,
     @cacheReadTokens, @cacheCreationTokens,
     @durationMs, @errorType, @errorMessage,
     @reqSysLen, @reqMsgs, @reqTools, @reqChars,
    @optimized, @responseOutputChars, @responseHash,
    @requestHashBeforeOpt, @requestHashAfterOpt,
    @optimizerSavedChars, @optimizerSavedMessages)
`);

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * Log one API call. Safe to call — errors are caught and printed, never thrown.
 * @param {object} opts
 * @param {string} opts.endpoint   - "/v1/messages" | "/v1/chat/completions" | "/v1/responses"
 * @param {string} opts.model
 * @param {string} [opts.account]  - email of selected account
 * @param {boolean} opts.stream
 * @param {string} opts.status     - "success" | "error" | "rate_limited"
 * @param {number} [opts.inputTokens]
 * @param {number} [opts.outputTokens]
 * @param {number} [opts.cacheReadTokens]     - tokens served from cache (cache_read_input_tokens)
 * @param {number} [opts.cacheCreationTokens] - tokens written to cache (cache_creation_input_tokens)
 * @param {number} [opts.durationMs]
 * @param {string} [opts.errorType]
 * @param {string} [opts.errorMessage]
 * @param {object} [opts.reqInfo]            - { sysLen, msgs, tools, chars } for debug
 * @param {boolean} [opts.optimized]         - whether request optimizer was applied
 * @param {object} [opts.trace]              - lightweight trace hashes/savings
 */
export function logCall(opts) {
    try {
        const now = new Date();
        // Use local date/hour (not UTC) so stats match user's timezone
        const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        stmtInsert.run({
            timestamp:     now.toISOString(),
            date:          localDate,
            hour:          now.getHours(),
            endpoint:      opts.endpoint,
            model:         opts.model || 'unknown',
            account:       opts.account || null,
            stream:        opts.stream ? 1 : 0,
            status:        opts.status,
            inputTokens:          opts.inputTokens        || 0,
            outputTokens:         opts.outputTokens       || 0,
            totalTokens:          (opts.inputTokens || 0) + (opts.outputTokens || 0),
            cacheReadTokens:      opts.cacheReadTokens    || 0,
            cacheCreationTokens:  opts.cacheCreationTokens || 0,
            durationMs:    opts.durationMs   || null,
            errorType:     opts.errorType    || null,
            errorMessage:  opts.errorMessage || null,
            reqSysLen:     opts.reqInfo?.sysLen  ?? null,
            reqMsgs:       opts.reqInfo?.msgs    ?? null,
            reqTools:      opts.reqInfo?.tools   ?? null,
            reqChars:      opts.reqInfo?.chars   ?? null,
            optimized:     opts.optimized ? 1 : 0,
            responseOutputChars:    opts.trace?.responseOutputChars    ?? null,
            responseHash:           opts.trace?.responseHash           ?? null,
            requestHashBeforeOpt:   opts.trace?.requestHashBeforeOpt   ?? null,
            requestHashAfterOpt:    opts.trace?.requestHashAfterOpt    ?? null,
            optimizerSavedChars:    opts.trace?.optimizerSavedChars    ?? null,
            optimizerSavedMessages: opts.trace?.optimizerSavedMessages ?? null,
        });
    } catch (err) {
        // Never let DB errors affect API responses
        console.error('[CallLogger] Failed to log call:', err.message);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function periodToDateFilter(period) {
    const _n = new Date();
    const today = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
    if (period === 'today') return `date = '${today}'`;
    if (period === '7d')    return `date >= date('${today}', '-6 days')`;
    if (period === '30d')   return `date >= date('${today}', '-29 days')`;
    return '1=1'; // "all"
}

// ── Read: Summary Stats ────────────────────────────────────────────────────

/**
 * Get aggregate stats for a period.
 * @param {'today'|'7d'|'30d'|'all'} period
 * @returns {{ totalCalls, successCalls, errorCalls, rateLimitedCalls,
 *             totalTokens, inputTokens, outputTokens, avgDurationMs, successRate }}
 */
export function getStats(period = 'today') {
    const where = periodToDateFilter(period);
    const row = db.prepare(`
        SELECT
            COUNT(*)                                        AS totalCalls,
            SUM(CASE WHEN status='success'      THEN 1 ELSE 0 END) AS successCalls,
            SUM(CASE WHEN status='error'        THEN 1 ELSE 0 END) AS errorCalls,
            SUM(CASE WHEN status='rate_limited' THEN 1 ELSE 0 END) AS rateLimitedCalls,
            SUM(total_tokens)                               AS totalTokens,
            SUM(input_tokens)                               AS inputTokens,
            SUM(output_tokens)                              AS outputTokens,
            SUM(cache_read_tokens)                          AS cacheReadTokens,
            SUM(cache_creation_tokens)                      AS cacheCreationTokens,
            AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) AS avgDurationMs
        FROM api_calls
        WHERE ${where}
    `).get();

    const total = row.totalCalls || 0;
    return {
        totalCalls:       total,
        successCalls:     row.successCalls     || 0,
        errorCalls:       row.errorCalls       || 0,
        rateLimitedCalls: row.rateLimitedCalls || 0,
        totalTokens:      row.totalTokens      || 0,
        inputTokens:      row.inputTokens      || 0,
        outputTokens:     row.outputTokens     || 0,
        cacheReadTokens:     row.cacheReadTokens     || 0,
        cacheCreationTokens: row.cacheCreationTokens || 0,
        avgDurationMs:    row.avgDurationMs ? Math.round(row.avgDurationMs) : null,
        successRate:      total > 0 ? Math.round((row.successCalls / total) * 1000) / 10 : null,
    };
}

// ── Read: Paginated Call List ──────────────────────────────────────────────

/**
 * Get paginated list of calls with optional filters.
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=50]
 * @param {string} [opts.model]
 * @param {string} [opts.status]
 * @param {string} [opts.date]     - "YYYY-MM-DD"
 * @param {string} [opts.account]
 * @returns {{ rows, total, page, totalPages }}
 */
export function getCalls({ page = 1, limit = 50, model, status, date, account } = {}) {
    const conditions = [];
    const params = {};

    if (model)   { conditions.push(`model = @model`);     params.model   = model; }
    if (status)  { conditions.push(`status = @status`);   params.status  = status; }
    if (date)    { conditions.push(`date = @date`);        params.date    = date; }
    if (account) { conditions.push(`account = @account`); params.account = account; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const total = db.prepare(`SELECT COUNT(*) AS n FROM api_calls ${where}`).get(params).n;
    const rows  = db.prepare(`
        SELECT id, timestamp, endpoint, model, account, stream,
               status, input_tokens, output_tokens, total_tokens,
               cache_read_tokens, cache_creation_tokens,
               duration_ms, error_type, error_message,
               request_system_len, request_messages, request_tools, request_chars,
               optimized
        FROM api_calls ${where}
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}
    `).all(params);

    return {
        rows,
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
    };
}

// ── Read: Hourly Breakdown ─────────────────────────────────────────────────

/**
 * Get calls and tokens grouped by hour for a specific date.
 * Returns 24 entries (hour 0–23), filling zeros for empty hours.
 * @param {string} [date] - "YYYY-MM-DD", defaults to today
 * @returns {Array<{ hour, calls, total_tokens, success, error }>}
 */
export function getHourlyBreakdown(date) {
    const _n = new Date();
    const localToday = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
    const d = date || localToday;
    const rows = db.prepare(`
        SELECT
            hour,
            COUNT(*)                                        AS calls,
            SUM(total_tokens)                               AS total_tokens,
            SUM(CASE WHEN status='success'      THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status='error'        THEN 1 ELSE 0 END) AS error,
            SUM(CASE WHEN status='rate_limited' THEN 1 ELSE 0 END) AS rate_limited
        FROM api_calls
        WHERE date = ?
        GROUP BY hour
        ORDER BY hour
    `).all(d);

    // Fill all 24 hours
    const map = Object.fromEntries(rows.map(r => [r.hour, r]));
    return Array.from({ length: 24 }, (_, h) => map[h] || {
        hour: h, calls: 0, total_tokens: 0, success: 0, error: 0, rate_limited: 0
    });
}

// ── Read: Daily Breakdown ──────────────────────────────────────────────────

/**
 * Get calls and tokens grouped by day for the last N days.
 * @param {number} [days=7]
 * @returns {Array<{ date, calls, total_tokens, success, error }>}
 */
export function getDailyBreakdown(days = 7) {
    const _now = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
    const rows = db.prepare(`
        SELECT
            date,
            COUNT(*)                                        AS calls,
            SUM(total_tokens)                               AS total_tokens,
            SUM(CASE WHEN status='success'      THEN 1 ELSE 0 END) AS success,
            SUM(CASE WHEN status='error'        THEN 1 ELSE 0 END) AS error
        FROM api_calls
        WHERE date >= date(?, '-${days - 1} days')
        GROUP BY date
        ORDER BY date
    `).all(today);

    // Fill missing days using local date
    const map = Object.fromEntries(rows.map(r => [r.date, r]));
    return Array.from({ length: days }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (days - 1 - i));
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        return map[key] || { date: key, calls: 0, total_tokens: 0, success: 0, error: 0 };
    });
}

// ── Read: Model Breakdown ──────────────────────────────────────────────────

/**
 * Get calls and tokens grouped by model for a period.
 * @param {'today'|'7d'|'30d'|'all'} period
 * @returns {Array<{ model, calls, total_tokens, input_tokens, output_tokens, avg_duration_ms }>}
 */
export function getModelBreakdown(period = '7d') {
    const where = periodToDateFilter(period);
    return db.prepare(`
        SELECT
            model,
            COUNT(*)            AS calls,
            SUM(total_tokens)   AS total_tokens,
            SUM(input_tokens)   AS input_tokens,
            SUM(output_tokens)  AS output_tokens,
            SUM(cache_read_tokens)      AS cache_read_tokens,
            SUM(cache_creation_tokens)  AS cache_creation_tokens,
            AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) AS avg_duration_ms
        FROM api_calls
        WHERE ${where}
        GROUP BY model
        ORDER BY calls DESC
    `).all();
}

// ── Read: Distinct filter values ───────────────────────────────────────────

/** Get list of distinct models that have been called */
export function getDistinctModels() {
    return db.prepare(`SELECT DISTINCT model FROM api_calls ORDER BY model`).all().map(r => r.model);
}

/** Get list of distinct accounts that have been used */
export function getDistinctAccounts() {
    return db.prepare(`SELECT DISTINCT account FROM api_calls WHERE account IS NOT NULL ORDER BY account`).all().map(r => r.account);
}

// ── Settings (key-value store) ─────────────────────────────────────────────

const stmtGetSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const stmtSetSetting = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);

/**
 * Get a setting value by key.
 * @param {string} key
 * @returns {string|null}
 */
export function getSetting(key) {
    const row = stmtGetSetting.get(key);
    return row ? row.value : null;
}

/**
 * Set a setting value by key.
 * @param {string} key
 * @param {string} value
 */
export function setSetting(key, value) {
    stmtSetSetting.run(key, value);
}
