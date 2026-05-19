# Sử dụng base image Python chính thức (phiên bản slim để giảm kích thước)
FROM python:3.10-slim

# Cài đặt FFmpeg và các thư viện hệ thống cần thiết
RUN apt-get update && apt-get install -y \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Sao chép file requirements và cài đặt các thư viện Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Cài đặt thêm gunicorn làm production server
RUN pip install --no-cache-dir gunicorn

# Sao chép toàn bộ mã nguồn vào container
COPY . .

# Tạo các thư mục lưu trữ tạm thời cần thiết
RUN mkdir -p uploads downloads temp

# Cấu hình biến môi trường
ENV FLASK_ENV=production
ENV PORT=5000

# Mở cổng 5000
EXPOSE 5000

# Chạy ứng dụng Flask bằng Gunicorn với thời gian timeout dài (10 phút) để phục vụ AI tách nhạc
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "4", "--timeout", "600", "app:app"]
