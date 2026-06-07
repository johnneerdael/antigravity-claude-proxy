# Release Note / Review Input — Call Logging, Analytics Dashboard, Request Optimizer

## 1. Mục tiêu thay đổi

Bản thay đổi này bổ sung một hệ thống theo dõi request/response cho Antigravity Gateway, gồm:

1. Ghi log API calls vào SQLite để phục vụ phân tích.
2. Dashboard hiển thị quota, logs, thống kê token, cache token, biểu đồ và lịch sử request.
3. Thêm Request Optimizer có thể bật/tắt từ UI để giảm context/token khi client gửi request quá lớn.
4. Thêm trace nhẹ bằng hash/metrics để review về sau việc optimizer có làm thay đổi response hay không, nhưng không lưu full response.
5. Cải thiện hiển thị UI cho timezone Việt Nam `GMT+7`.

## 2. Hai điểm review ưu tiên tuyệt đối

Reviewer cần ưu tiên kiểm tra kỹ 2 yêu cầu sau:

### 2.1. Khi optimizer **được bật**

Optimizer phải thực sự hoạt động theo đúng mục tiêu:

- Giảm số lượng messages gửi đi nếu vượt `maxMessages`.
- Giảm kích thước tool results dài.
- Nén/cắt system prompt nếu vượt `maxSystemChars`.
- Giữ tool definitions nếu `keepTools = true`.
- Không tạo request sai protocol tool/function calling.
- Ghi `optimized = 1` vào DB cho request được xử lý khi optimizer bật.
- Ghi đầy đủ trace:
  - `request_hash_before_opt`
  - `request_hash_after_opt`
  - `optimizer_saved_chars`
  - `optimizer_saved_messages`
  - `response_hash`
  - `response_output_chars`

### 2.2. Khi optimizer **không bật**

Đây là yêu cầu quan trọng nhất về backward compatibility:

- Luồng xử lý request phải giống hành vi cũ tuyệt đối nhất có thể.
- Không được trim/cắt/xóa messages.
- Không được thay đổi tools/system prompt.
- Request gửi sang CloudCode phải giữ nguyên như trước.
- `optimized = 0` trong DB.
- `optimizer_saved_chars` và `optimizer_saved_messages` phải bằng `0` hoặc không tạo khác biệt có ý nghĩa.
- Không được làm thay đổi response của AI so với phiên bản trước khi có optimizer.

## 3. Tổng quan các nhóm thay đổi

### 3.1. SQLite call logging

Thêm SQLite DB tại:

`~/.config/antigravity-gateway/call-logs.db`

DB dùng `better-sqlite3`, WAL mode, schema gồm:

- `api_calls`: lưu lịch sử request.
- `settings`: key-value store để lưu cấu hình optimizer.

Các dữ liệu được log:

- endpoint
- model
- account
- stream/non-stream
- status
- input/output/total tokens
- cache read/cache creation tokens
- duration
- error type/message
- request messages/tools/chars
- optimizer flag
- lightweight request/response trace hash

### 3.2. Analytics API

Thêm các API nội bộ phục vụ dashboard:

- `GET /api/logs/stats?period=today|7d|30d|all`
- `GET /api/logs/calls?page=1&limit=50&model=&status=&date=&account=`
- `GET /api/logs/breakdown?type=hourly|daily|model`
- `GET /api/logs/filters`
- `GET /api/logs/optimizer`
- `POST /api/logs/optimizer`

### 3.3. Dashboard Logs UI

Dashboard hiện có thêm phần `Call Logs & Analytics` gồm:

- Bộ lọc period/model/status/date.
- Summary cards:
  - total calls
  - success rate
  - total tokens
  - cache read/write tokens
- Chart hourly/daily bằng Chart.js.
- Model breakdown.
- Call history table với pagination.
- Cột `⚡` để biết request đó có bật optimizer không.

### 3.4. Request Optimizer

Thêm module mới:

`src/request-optimizer.js`

Chức năng:

- Cấu hình mặc định:
  - `enabled: false`
  - `maxMessages: 50`
  - `maxToolResults: 20`
  - `keepTools: true`
  - `maxSystemChars: 2000`
- Load/save config vào SQLite `settings`.
- Optimize request format OpenAI và Anthropic.
- Sanitizer bảo vệ tool/function calling sequence sau khi trim:
  - Xóa orphan tool response.
  - Chỉ giữ assistant tool call nếu đủ tool response hợp lệ ngay sau đó.
  - Xóa/strip block tool call không hợp lệ do bị cắt context.

### 3.5. Optimizer UI

Optimizer có thể bật/tắt từ:

1. Dashboard header button:
   - `⚡ Opt: ON`
   - `⚡ Opt: OFF`

2. System tab:
   - Enable Optimizer toggle
   - Max Messages
   - Max Tool Results
   - Keep Tools
   - Max System Chars

Config được persist vào DB, không cần CLI flag.

### 3.6. Lightweight trace để đánh giá optimizer

Thêm các cột DB:

- `response_output_chars`
- `response_hash`
- `request_hash_before_opt`
- `request_hash_after_opt`
- `optimizer_saved_chars`
- `optimizer_saved_messages`

Mục tiêu:

- Không lưu full request/response nhạy cảm.
- Có hash và metrics để đối chiếu về sau.
- Có thể so sánh optimized vs non-optimized theo hash/chars/token.

### 3.7. Cache token tracking

Bổ sung tracking:

- `cache_read_tokens`
- `cache_creation_tokens`

UI hiển thị cache tokens trong logs table và stats.

### 3.8. Timezone Việt Nam trong UI

Trong `Account & Quota Monitor`, reset time hiện hiển thị đủ ngày + giờ theo timezone Việt Nam:

`Asia/Ho_Chi_Minh` / `GMT+7`

Ví dụ:

`Resets: 10/06/2026 10:59:29 (GMT+7)`

`Last updated` cũng dùng GMT+7.

## 4. File thay đổi

### 4.1. Modified tracked files theo `git diff --stat`

`git diff --stat` hiện tại:

```text
 public/app.js     | 361 ++++++++++++++++++++++++++++++++++++++++++++++++++++--
 public/index.html | 240 +++++++++++++++++++++++++++++++++++-
 public/style.css  |   6 +
 src/server.js     | 315 +++++++++++++++++++++++++++++++++++++++++++----
 4 files changed, 887 insertions(+), 35 deletions(-)
```

Files:

- `public/app.js`
- `public/index.html`
- `public/style.css`
- `src/server.js`

### 4.2. Untracked/new files theo `git status --short`

```text
?? _check2.mjs
?? _check_db.mjs
?? src/db/
?? src/request-optimizer.js
```

Files mới quan trọng:

- `src/db/index.js`
- `src/db/call-logger.js`
- `src/request-optimizer.js`

Files tạm nên reviewer cân nhắc không commit hoặc xóa trước khi merge:

- `_check2.mjs`
- `_check_db.mjs`

## 5. Chi tiết theo file

### 5.1. `src/db/index.js` mới

Chức năng:

- Khởi tạo SQLite database.
- DB path: `~/.config/antigravity-gateway/call-logs.db`.
- Bật WAL mode.
- Tạo bảng `api_calls`.
- Tạo indexes:
  - `idx_date`
  - `idx_model`
  - `idx_account`
  - `idx_hour`
  - `idx_status`
- Auto migration bằng `ALTER TABLE` cho các cột mới.
- Tạo bảng `settings`.

Impact:

- Có file DB local trên máy user.
- Không ảnh hưởng API response nếu log DB lỗi, vì logCall catch lỗi.

### 5.2. `src/db/call-logger.js` mới

Chức năng:

- `logCall()` ghi request vào DB.
- `getStats(period)`.
- `getCalls({ page, limit, model, status, date, account })`.
- `getHourlyBreakdown(date)`.
- `getDailyBreakdown(days)`.
- `getModelBreakdown(period)`.
- `getDistinctModels()`.
- `getDistinctAccounts()`.
- `getSetting(key)` / `setSetting(key, value)`.

Impact:

- Tạo nền tảng cho analytics UI.
- `logCall()` không throw để tránh ảnh hưởng API chính.

### 5.3. `src/request-optimizer.js` mới

Chức năng:

- Quản lý config optimizer.
- Persist config vào DB settings.
- Optimize Anthropic request.
- Optimize OpenAI request.
- Sanitize tool/function call sequence.

Điểm cần review kỹ:

- `optimizeOpenAIRequest()` không chạy khi `enabled = false`.
- `optimizeAnthropicRequest()` không chạy khi `enabled = false`.
- Sanitizer không xóa nhầm messages quan trọng.
- Khi trim, không tạo chuỗi tool call/tool response sai format.
- `keepTools = true` mặc định để tránh làm mất tool definitions.

### 5.4. `src/server.js`

Thay đổi chính:

- Import DB logger.
- Import optimizer.
- Import `crypto` để hash trace.
- Load optimizer config từ DB khi startup.
- Thêm trace helper:
  - `stableStringify()`
  - `sha256Short()`
  - `makeRequestTrace()`
  - `makeResponseTrace()`
  - `createStreamingTrace()`
- Gọi optimizer trước khi xử lý:
  - `/v1/messages`
  - `/v1/chat/completions`
- Ghi `logCall()` cho success/error/rate limit ở các endpoint:
  - `/v1/messages`
  - `/v1/chat/completions`
  - `/v1/responses`
- Thêm analytics endpoints.
- Thêm optimizer endpoints.
- Export default `app` để `src/index.js` import được.

Impact:

- Backend có thêm logging overhead nhẹ.
- Streaming response có hash/chars trace bằng cách hash SSE chunks, không lưu full response.
- Nếu DB lỗi, API không nên bị ảnh hưởng vì logger catch lỗi.
- Optimizer hiện không áp dụng cho `/v1/responses`, nhưng vẫn log trace.

### 5.5. `public/index.html`

Thay đổi chính:

- Thêm Chart.js CDN.
- Dashboard thêm Logs & Analytics section.
- Dashboard header thêm button `⚡ Opt: ON/OFF`.
- Call History table thêm cột optimizer `⚡`.
- System tab thêm Request Optimizer card.
- Thêm CSS inline cho dark native form controls.

Impact:

- UI dashboard lớn hơn đáng kể.
- Cần review responsive layout.
- Có một section `tab-content-logs` cũ/hay duplicate nên reviewer cần kiểm tra ID trùng với dashboard logs nếu có ảnh hưởng thực tế.

### 5.6. `public/app.js`

Thay đổi chính:

- Thêm formatter timezone Việt Nam.
- Load/render dashboard quota.
- Toggle account enable/disable.
- Toggle quota show/hide.
- Load logs stats/charts/filters/table.
- Render Chart.js hourly/daily.
- Render model breakdown.
- Render call history table với pagination.
- Load/toggle optimizer config.
- Dashboard optimizer button sync với System tab.
- Format reset time theo `Asia/Ho_Chi_Minh`.

Impact:

- Nhiều logic UI mới.
- Cần test trên browser.
- Cần review các DOM id có duplicate không gây lỗi.

### 5.7. `public/style.css`

Thay đổi:

- Thêm `color-scheme: dark`/style cho native inputs.

Impact:

- Date/select input hiển thị đúng dark theme.

## 6. API/DB behavior cần review

### 6.1. `/api/logs/stats`

Cần kiểm tra:

- `today`, `7d`, `30d`, `all`.
- Timezone local date có đúng kỳ vọng không.
- Tổng tokens/cache tokens đúng.

### 6.2. `/api/logs/calls`

Cần kiểm tra:

- Pagination.
- Filter model/status/date/account.
- Có trả `optimized` để UI hiển thị cờ.

### 6.3. `/api/logs/breakdown`

Cần kiểm tra:

- `type=hourly` đủ 24 giờ.
- `type=daily` đủ ngày, fill missing day.
- `type=model` group đúng.

### 6.4. `/api/logs/optimizer`

Cần kiểm tra:

- `GET` trả đúng config.
- `POST` merge config hiện tại, không reset field khác khi chỉ toggle `enabled`.
- Config persist sau restart.

## 7. Kết quả test thủ công đã thực hiện

### 7.1. Compile/import checks

Đã chạy các import check nhiều lần:

- Server import OK.
- `src/server.js` có default export app.
- Request optimizer sanitizer compile OK.
- Trace fields compile OK.

### 7.2. DB migration check

Đã verify các trace columns tồn tại:

```text
response_output_chars    INTEGER
response_hash            TEXT
request_hash_before_opt  TEXT
request_hash_after_opt   TEXT
optimizer_saved_chars    INTEGER
optimizer_saved_messages INTEGER
```

### 7.3. Optimized vs non-optimized DB sample

Quan sát từ DB:

Optimized success sample:

- request messages khoảng `40–42`
- request chars khoảng `184K–189K`
- input tokens khoảng `49K–50K`

Non-optimized success sample:

- request messages khoảng `279–281`
- request chars khoảng `690K–693K`
- input tokens khoảng `200K`

Kết luận sơ bộ:

- Optimizer giảm context mạnh.
- `optimized` flag lưu đúng.
- Sau khi sửa sanitizer, request optimized đã success.

## 8. Risk / Impact analysis

### 8.1. Functional risk

Rủi ro lớn nhất là optimizer cắt history làm response AI khác đi về mặt semantic.

Giảm thiểu hiện tại:

- Optimizer mặc định `enabled = false`.
- Có toggle rõ ràng ở UI.
- Có trace hash/metrics để so sánh.
- Không xóa tools mặc định.
- Có sanitizer tool/function sequence.

### 8.2. Backward compatibility risk

Khi optimizer off, code vẫn gọi function optimizer nhưng function return ngay nếu `enabled = false`.

Reviewer cần xác nhận:

- Request object không bị mutate khi `enabled = false`.
- Response path không đổi.
- DB logging không ảnh hưởng response.

### 8.3. Performance risk

Có overhead:

- `JSON.stringify()` request trước/sau optimize để tính hash/saved chars.
- Hash response/stream chunks.
- SQLite insert mỗi request.

Đánh giá sơ bộ:

- Chấp nhận được cho local gateway/admin dashboard.
- Nhưng request rất lớn có thể tăng CPU nhẹ.

### 8.4. Privacy/security risk

Không lưu full response/request content.

Chỉ lưu:

- hash ngắn SHA-256 16 chars
- chars count
- token count
- model/account/status
- error message

Cần lưu ý:

- `error_message` vẫn có thể chứa thông tin upstream, cần review nếu có sensitive data.

### 8.5. UI risk

- Dashboard thêm nhiều component.
- Có khả năng duplicate DOM ids do logs section từng nằm riêng và nay nằm trong dashboard.
- Cần test browser kỹ.

## 9. Checklist review bắt buộc

### 9.1. Optimizer OFF — bắt buộc pass

- [ ] Start server fresh, optimizer config `enabled=false`.
- [ ] Gửi `/v1/chat/completions` non-stream.
- [ ] Gửi `/v1/chat/completions` stream.
- [ ] Gửi `/v1/messages` non-stream.
- [ ] Gửi `/v1/messages` stream.
- [ ] Confirm request không bị trim.
- [ ] Confirm `optimized=0` trong DB.
- [ ] Confirm `request_hash_before_opt == request_hash_after_opt` hoặc saved chars/messages = 0.
- [ ] Confirm response behavior giống trước khi có optimizer.
- [ ] Confirm không có lỗi tool/function turn ordering.

### 9.2. Optimizer ON — bắt buộc pass

- [ ] Bật optimizer từ Dashboard button.
- [ ] Bật/tắt optimizer từ System tab.
- [ ] Config persist sau restart.
- [ ] Gửi request lớn có > `maxMessages`.
- [ ] Confirm messages được giảm xuống gần `maxMessages` hoặc ít hơn sau sanitizer.
- [ ] Confirm `optimized=1` trong DB.
- [ ] Confirm `optimizer_saved_chars > 0` với request lớn.
- [ ] Confirm `optimizer_saved_messages > 0` với request nhiều messages.
- [ ] Confirm không còn lỗi:
  - `function response turn comes immediately after a function call turn`
  - `function call turn comes immediately after a user turn or after a function response turn`
- [ ] Confirm response không rỗng/bất thường.

### 9.3. Dashboard/UI

- [ ] Account & Quota Monitor hiển thị account đúng.
- [ ] Reset time hiển thị đủ ngày + giờ GMT+7.
- [ ] Disable/Activate account vẫn hoạt động.
- [ ] `⚡ Opt: ON/OFF` ở Dashboard sync đúng với System tab.
- [ ] Logs table hiển thị cột `⚡` đúng.
- [ ] Filters model/status/date hoạt động.
- [ ] Pagination hoạt động.
- [ ] Chart không bị infinite height.
- [ ] Dark theme select/date input hiển thị đúng.

### 9.4. DB/API

- [ ] DB file được tạo đúng tại `~/.config/antigravity-gateway/call-logs.db`.
- [ ] `api_calls` có đủ columns.
- [ ] `settings` có `optimizer_config`.
- [ ] `/api/logs/stats` hoạt động.
- [ ] `/api/logs/calls` hoạt động.
- [ ] `/api/logs/breakdown` hoạt động.
- [ ] `/api/logs/filters` hoạt động.
- [ ] `/api/logs/optimizer` GET/POST hoạt động.

### 9.5. Error handling

- [ ] Nếu DB insert lỗi, API response vẫn không bị fail.
- [ ] Rate limited/error request vẫn được log.
- [ ] Stream error vẫn log status `error` hoặc `rate_limited`.
- [ ] Không double-send response khi stream error.

## 10. Reviewer nên kiểm tra thêm bằng SQL

Ví dụ query recent calls:

```sql
SELECT id, timestamp, endpoint, model, status, optimized,
       input_tokens, output_tokens, duration_ms,
       request_messages, request_tools, request_chars,
       optimizer_saved_chars, optimizer_saved_messages,
       response_output_chars, request_hash_before_opt,
       request_hash_after_opt, response_hash
FROM api_calls
ORDER BY id DESC
LIMIT 20;
```

So sánh optimized vs non-optimized:

```sql
SELECT optimized,
       COUNT(*) calls,
       SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success,
       ROUND(AVG(input_tokens), 1) avg_input,
       ROUND(AVG(output_tokens), 1) avg_output,
       ROUND(AVG(request_messages), 1) avg_messages,
       ROUND(AVG(request_chars), 1) avg_chars,
       ROUND(AVG(optimizer_saved_chars), 1) avg_saved_chars,
       ROUND(AVG(optimizer_saved_messages), 1) avg_saved_messages
FROM api_calls
GROUP BY optimized;
```

Kiểm tra optimizer config:

```sql
SELECT * FROM settings WHERE key = 'optimizer_config';
```

## 11. Ghi chú cleanup trước khi merge

Reviewer/author nên quyết định:

- [ ] Có commit `_check2.mjs` không? Khuyến nghị: không commit nếu chỉ là script tạm.
- [ ] Có commit `_check_db.mjs` không? Khuyến nghị: không commit nếu chỉ là script tạm.
- [ ] Có cần thêm docs/README cho dashboard logs/optimizer không?
- [ ] Có cần thêm test tự động cho optimizer sanitizer không?

## 12. Kết luận

Bản thay đổi mang lại khả năng quan sát và tối ưu token rất lớn, đặc biệt với request từ Copilot có hàng trăm messages và nhiều tools.

Tuy nhiên, phần optimizer là thay đổi nhạy cảm vì có thể ảnh hưởng ngữ cảnh đầu vào của AI. Do đó review cần tập trung tuyệt đối vào 2 điều kiện:

1. **Optimizer bật thì phải optimize đúng, an toàn tool/function protocol, có trace đầy đủ.**
2. **Optimizer tắt thì hành vi phải giống hệ thống cũ, không mutate request, không làm lệch response.**
