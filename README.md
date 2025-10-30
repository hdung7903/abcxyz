# Coursera Request Blocker Extension

Extension trình duyệt để chặn request đến Coursera eventing API.

## Tính năng

- ✅ Chặn tất cả request đến `https://www.coursera.org/api/rest/v1/eventing/infobatch`
- ✅ Bật/tắt chặn dễ dàng qua popup
- ✅ Giao diện tiếng Việt thân thiện
- ✅ Sử dụng Declarative Net Request API (hiệu suất cao)

## Cài đặt

### Chrome/Edge/Brave

1. Mở trình duyệt và vào `chrome://extensions/` (hoặc `edge://extensions/`)
2. Bật chế độ "Developer mode" (Chế độ nhà phát triển)
3. Click "Load unpacked" (Tải tiện ích giải nén)
4. Chọn thư mục `blocking` này
5. Extension sẽ được cài đặt và sẵn sàng sử dụng!

### Tạo icon PNG (tùy chọn)

Hiện tại extension sử dụng file SVG. Nếu bạn muốn tạo icon PNG:

1. Mở file `icons/icon.svg` trong trình duyệt
2. Sử dụng công cụ như:
   - https://www.svgtopng.com/
   - https://cloudconvert.com/svg-to-png
   - Hoặc Photoshop/GIMP
3. Xuất ra 3 kích thước: 16x16, 48x48, 128x128 pixels
4. Lưu vào thư mục `icons/` với tên:
   - `icon16.png`
   - `icon48.png`
   - `icon128.png`

**Tạm thời**: Nếu không muốn tạo PNG, bạn có thể xóa các dòng `"icons"` và `"default_icon"` trong `manifest.json`.

## Cách sử dụng

1. Vào trang web Coursera.org
2. Click vào icon extension trên thanh công cụ
3. Trạng thái mặc định là "Đang chặn request"
4. Click nút để bật/tắt chặn khi cần

## Kiểm tra hoạt động

1. Mở DevTools (F12)
2. Vào tab Network
3. Lọc theo "infobatch"
4. Khi extension đang bật, bạn sẽ thấy request bị chặn (hiển thị màu đỏ hoặc status "blocked")

## File trong project

- `manifest.json` - File cấu hình chính của extension
- `background.js` - Service worker xử lý logic nền
- `rules.json` - Quy tắc chặn request
- `popup.html` - Giao diện popup
- `popup.js` - Logic cho popup
- `icons/` - Thư mục chứa icon

## Lưu ý

- Extension sử dụng Manifest V3 (phiên bản mới nhất)
- Chỉ hoạt động trên domain coursera.org
- Request bị chặn hoàn toàn, không gửi đến server

## Hỗ trợ

Nếu có vấn đề, kiểm tra:
1. Extension đã được bật chưa
2. Đã reload trang Coursera sau khi cài extension
3. Console có báo lỗi gì không (F12 -> Console)

## License

MIT
