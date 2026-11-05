(() => {
  const form = document.querySelector('#auth-form');
  const notice = document.querySelector('#notice');
  const submit = form.querySelector('button[type="submit"]');
  const registering = form.dataset.mode === 'register';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    notice.className = 'notice';
    const values = Object.fromEntries(new FormData(form));
    if (registering && values.password !== values.confirm) {
      notice.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'; notice.className = 'notice error'; return;
    }
    submit.disabled = true; submit.textContent = 'กำลังดำเนินการ...';
    try {
      const response = await fetch(registering ? '/api/register' : '/api/login', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(values)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ไม่สามารถดำเนินการได้');
      notice.textContent = registering ? 'สร้างบัญชีสำเร็จ กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบสำเร็จ';
      notice.className = 'notice success';
      location.href = result.user?.role === 'admin' ? '/admin.html' : '/index.html';
    } catch (error) {
      notice.textContent = error.message === 'Failed to fetch' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณารัน python server.py' : error.message;
      notice.className = 'notice error';
      submit.disabled = false; submit.textContent = registering ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
    }
  });
})();
