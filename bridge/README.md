# Личный шлюз HDRezka для Lampa 1.3.0

Шлюз нужен для iOS/WebKit: прямые запросы к стороннему домену блокируются CORS, а cookies браузера Lampa не разделяются с HDRezka. Шлюз выступает HTTP-клиентом HDRezka, хранит cookies **только в памяти** и возвращает ответы Lampa через HTTPS.

**Ограничения:** шлюз не обходит Cloudflare, DRM и запреты аккаунта. На закрытых зеркалах он поддерживает стандартные HTML-формы входа (email/password), но формы, работающие исключительно через JavaScript, могут потребовать отдельной адаптации. Работа без доступа к конкретному аккаунту и зеркалу не подтверждена. HDRezka запрещает доступ через Lampa; блокировка аккаунта возможна.

## Требования

- Собственный VPS или Mac с Node.js 22+ либо Docker Compose.
- Личный домен с действительным TLS-сертификатом (Caddy/Nginx/другой reverse proxy).
- Указанный в `REZKA_ORIGIN` домен HDRezka должен совпадать с доменом в настройках плагина.
- **Не размещать** `.env` с токеном и пароль от HDRezka в GitHub.

## Docker на Ubuntu

Внутри клона репозитория:

~~~bash
cd bridge
cp .env.example .env
openssl rand -hex 32
~~~

Полученный токен вставьте в `.env` как `REZKA_BRIDGE_TOKEN`, замените `REZKA_ORIGIN` на свой HTTPS-домен зеркала HDRezka.

~~~bash
chmod 600 .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl -fsS -H "X-Rezka-Bridge-Token: $(grep '^REZKA_BRIDGE_TOKEN=' .env | cut -d= -f2-)" http://127.0.0.1:8787/v1/status
~~~

В Docker опубликован **только `127.0.0.1:8787`**. Не открывайте его порт в интернет напрямую.

## HTTPS с существующим reverse proxy

Добавьте отдельный домен, например `rezka-bridge.example.com`, направив его на сервер. В Caddy:

~~~caddyfile
rezka-bridge.example.com {
    reverse_proxy 127.0.0.1:8787
}
~~~

Не заменяйте существующую конфигурацию Caddy целиком. Проверьте TLS, затем:

~~~bash
curl -i -H "X-Rezka-Bridge-Token: $(grep '^REZKA_BRIDGE_TOKEN=' .env | cut -d= -f2-)" https://rezka-bridge.example.com/v1/status
~~~

Ожидается `200` и JSON с `ok: true`. `authenticated: false` означает, что нужно выполнить вход. `gateway: true` сообщает о дополнительной странице входа зеркала; `cloudflare: true` означает, что запрос блокируется Cloudflare.

## Настройки в Lampa

1. Установите `rezka.js` 1.3.0 и перезапустите Lampa.
2. **HDREZKA → Домен**: тот же HTTPS-адрес, что и `REZKA_ORIGIN` сервера.
3. **Личный HTTPS-шлюз**: `https://rezka-bridge.example.com` без `/v1`.
4. **Токен личного шлюза**: вставьте токен из `.env` в диалог; он не отображается в списке настроек, но хранится локально в Lampa.
5. **Проверить личный шлюз** → **Войти в аккаунт** → **Открыть избранное HDRezka**.

Пароль HDRezka отправляется только в собственный HTTPS-шлюз и затем в настроенное зеркало, не сохраняется в Lampa или на диске шлюза. Сервер хранит сессионные cookies в памяти до выхода или перезапуска. Это **одна сессия на один экземпляр шлюза**. Не публикуйте ссылку и токен.

## Проверки и откат

~~~bash
node --check ../rezka.js
node --check server.cjs
node --test test.cjs
docker compose logs --tail=30
~~~

Не выводите в логи пароль, токен и cookies. Для отката JS-файла используйте ветку `backup/pre-bridge-1.3.0`; для остановки шлюза: `docker compose down`.

## Конфигурация

| Переменная | Назначение |
| --- | --- |
| `REZKA_ORIGIN` | HTTPS-домен зеркала |
| `REZKA_BRIDGE_TOKEN` | Случайный токен длиной от 32 символов |
| `BRIDGE_HOST` | Адрес bind внутри контейнера |
| `BRIDGE_PORT` | HTTP-порт шлюза, по умолчанию 8787 |

Шлюз разрешает только чтение избранного, поиск, страницы фильмов и AJAX-запросы входа/получения потока. Изменения избранного (создание, удаление) через API не поддерживаются.
