# TaskBoard — تسک‌برد شخصی رشاد

وب‌اپ مدیریت کارهای شخصی: سایت استاتیک + بک‌اند Cloudflare Worker + بات تلگرام با آلارم.

- 🌐 سایت: https://mar-mir.github.io/samimi-taskboard/
- 🤖 بات: https://t.me/samimitodobot

## بکاپ خودکار

GitHub Action هر شب ساعت ۰۲:۳۰ تهران از API ورکر خروجی می‌گیرد و در `tasks-backup.json` کامیت می‌کند (workflow_dispatch هم دارد).
