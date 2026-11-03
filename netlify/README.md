# Lampa + HDRezka через Netlify (без VPS)

Этот вариант использует **одну Netlify Function** и **Netlify Blobs**, без Docker, SSH, VPS или собственного домена. Данные аккаунта HDRezka не помещаются в GitHub. Плагин Lampa версии **1.3.0** уже поддерживает API такого шлюза.

**Статус:** реализация сохранена в репозитории, но работу с конкретным зеркалом и аккаунтом необходимо подтвердить после деплоя. Netlify не устраняет блокировки Cloudflare/JavaScript Challenge и не делает запрещённый правилами HDRezka доступ через Lampa разрешённым.

## Подключить GitHub в Netlify

1. В Netlify открой **Add new project → Import an existing project → GitHub**.
2. Выбери репозиторий **Alexgood321/lampa-hdrezka**, ветку **main**.
3. Конфигурация сборки будет считана из корневого `netlify.toml`; publish: `public`, Functions: `netlify/functions`.
4. До публикации или сразу после создай три переменные окружения с областью **Functions**, контекст **Production**:

| Переменная | Значение |
| --- | --- |
| `REZKA_ORIGIN` | `https://flymaterez.net/` (только если это рабочее зеркало аккаунта) |
| `REZKA_BRIDGE_TOKEN` | случайная строка не короче 32 символов |
| `REZKA_BRIDGE_KEY` | отдельный 32-байтовый ключ, представленный 64 шестнадцатеричными символами |

Генерация двух независимых случайных ключей на Mac:

~~~bash
printf 'REZKA_BRIDGE_TOKEN='; openssl rand -hex 32
printf 'REZKA_BRIDGE_KEY='; openssl rand -hex 32
~~~

**Токен** нужен в Lampa, **ключ шифрования** нужен только Netlify. Отметь переменные как **Secret** и после добавления сделай redeploy. Не выкладывай значения в GitHub и не отправляй пароли в чаты.

## Подключение Lampa

Путь: **Настройки → HDREZKA**.

- **Домен HDRezka:** такой же, как `REZKA_ORIGIN`.
- **Личный HTTPS-шлюз:** `https://<имя-проекта>.netlify.app` (без `/v1` и без лишнего пути).
- **Токен личного шлюза:** значение `REZKA_BRIDGE_TOKEN` (не путать с ключом AES).
- **Проверить личный шлюз:** должен подтвердить соединение.
- **Войти в аккаунт:** временный диалог пароля, после входа выполняется проверка `/favorites/`.
- **Избранное HDRezka:** коллекции, фильмы, сериалы и пагинация, без переноса в CUB/Trakt.

## Как проверить

Без токена запрос обязан возвращать `401`:

~~~bash
curl -i https://<имя-проекта>.netlify.app/v1/status
~~~

С токеном должен вернуть `200` и JSON с `ok: true`:

~~~bash
read -rs REZKA_TOKEN
curl -fsS -H "X-Rezka-Bridge-Token: $REZKA_TOKEN" \
  https://<имя-проекта>.netlify.app/v1/status
unset REZKA_TOKEN
~~~

`authenticated: false` до входа нормально. Если `cloudflare: true` или `gateway: true`, проверь ограничения зеркала. Если Function возвращает `502`, смотри журнал в **Netlify → Logs → Functions → bridge**, не включая логирование паролей.

## Почему Blobs и ограничения

Netlify Functions не гарантирует сохранение оперативной памяти между вызовами. Сессионные cookies записываются в Netlify Blobs, где они **дополнительно зашифрованы AES-256-GCM** ключом `REZKA_BRIDGE_KEY`. Используется strong-consistency для одного пользовательского сеанса. На одновременные изменения cookie из разных устройств не рассчитано: это персональный шлюз, а не мультипользовательская платформа.

**Риски:** сессия хранится в Netlify, а токен в настройках Lampa, где его могут прочитать другие установленные JS-плагины. При компрометации токена меняй его в Netlify и Lampa. При компрометации ключа шифрования меняй ключ и перезапускай авторизацию. Использование Lampa может нарушать правила HDRezka.

## Откат

Старая версия плагина сохранена в ветке `backup/pre-bridge-1.3.0`. Если Netlify мешает, очисти поле шлюза в Lampa. Отключение Netlify Site не затрагивает VPN-инфраструктуру. Для полного удаления серверной сессии вызови `POST /v1/logout` с токеном или удали Blob `primary` в store `rezka-private-session` через Netlify.

## Файлы

- `netlify/functions/bridge.mjs` — API `/v1/login`, `/v1/logout`, `/v1/status`, `/v1/proxy`.
- `package.json` — `@netlify/blobs`.
- `netlify.toml` — сборка и функции.
- `tests/netlify-bridge.test.mjs` — проверки токенов и безопасности маршрутов.
