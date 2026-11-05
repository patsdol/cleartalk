# ตั้งค่าให้ ClearTalk ดึงคอมเมนต์ YouTube

1. เปิด YouTube Data API v3 ใน Google Cloud project และสร้าง API key ตามคู่มือ Google: https://developers.google.com/youtube/v3/getting-started
2. เปิด PowerShell ในโฟลเดอร์โปรเจกต์ แล้วตั้งค่า key ในหน้าต่างนั้นก่อนเปิดเซิร์ฟเวอร์:

   ```powershell
   $env:YOUTUBE_API_KEY = "วาง_API_key_ของคุณตรงนี้"
   python server.py
   ```

3. เข้า ClearTalk ผ่าน `http://127.0.0.1:8000`, เปิด “ตรวจสอบข้อความ”, เลือก “ลิงก์ URL”, วางลิงก์วิดีโอ YouTube แล้วกด “วิเคราะห์ข้อความ”

คีย์จะถูกอ่านจาก environment ของ `server.py` และไม่ถูกส่งไปหน้าเว็บ อย่าใส่คีย์ใน HTML/JavaScript หรือ commit ลง Git หากเปิด PowerShell ใหม่ ต้องตั้งค่า key ใหม่ในหน้าต่างนั้นด้วย

ระบบดึงคอมเมนต์ระดับบนสุดได้ไม่เกิน 200 รายการต่อครั้ง วิดีโอต้องเปิดคอมเมนต์ไว้ และผลตรวจจับคำหยาบได้เฉพาะคำที่อยู่ในรายการคำที่เปิดใช้งานใน ClearTalk เท่านั้น
