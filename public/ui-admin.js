(function () {
  var UI = window.WingTrafficUI;
  if (!UI) return;
  UI.adminKit = {
    nav: [
      { href: '/campaign', label: 'Cấu hình chạy', admin: true },
      { href: '/test', label: 'Chạy thử', admin: true },
      { href: '/admin', label: 'Quản trị', admin: true }
    ],
    side: function (link) {
      return link('/admin#tong-quan', '📊', 'Tổng quan') + link('/admin#chien-dich', '📢', 'Chiến dịch') + link('/admin#tai-khoan', '👥', 'Tài khoản &amp; Ví') + link('/admin#thong-bao', '🧰', 'Hệ thống') +
        '<div class="sb-label">Công cụ</div>' + link('/campaign', '⚙', 'Cấu hình chạy') + link('/test', '▶', 'Chạy thử') + link('/my', '👤', 'Giao diện người dùng');
    }
  };
})();
