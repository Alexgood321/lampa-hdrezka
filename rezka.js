/*!
 * HDREZKA plugin for Lampa
 * --------------------------------------------------------
 *  - Online-balanser source (button "HDREZKA" on the card)
 *  - Account login (login + password) via /ajax/login/
 *  - Configurable mirror domain (default: rezka.fi)
 *  - Settings panel: domain / login / password / login button / status
 *
 *  Tested against the public HDREZKA site engine (DLE-based).
 *  Author: generated for the user via Perplexity Computer.
 *  License: MIT
 */
(function () {
    'use strict';

    if (window.rezka_plugin_ready) return;
    window.rezka_plugin_ready = true;

    /* ====================================================
     *  Plugin manifest (shown in Lampa "Extensions" panel)
     * ==================================================== */
    var manifest = {
        type: 'video',
        version: '1.4.0',
        name: 'HDREZKA',
        description: 'Просмотр и коллекции избранного HDRezka',
        component: 'rezka_online'
    };

    /* ====================================================
     *  Storage keys / defaults
     * ==================================================== */
    var STORAGE = {
        domain:   'rezka_domain',
        login:    'rezka_login',
        password: 'rezka_password',
        cookie:   'rezka_cookie',     // dle_user_id=...; dle_password=...
        status:   'rezka_status',     // 'logged' | 'guest' | 'error:<msg>'
        proxy:    'rezka_proxy_url',  // legacy CORS proxy
        bridge:   'rezka_bridge_url', // own HTTPS bridge
        token:    'rezka_bridge_token' // access token, never shown in settings
    };

    /* Безопасный вызов Lampa.Storage.add — в разных билдах Lampa
       сигнатура разная. Используем get(name, default) — это работает везде.
       Сразу и инициализируем по умолчаниям через set(…, default), если пусто. */
    function ensureDefaults() {
        var defaults = {};
        defaults[STORAGE.domain]   = 'https://rezka.fi';
        defaults[STORAGE.login]    = '';
        defaults[STORAGE.password] = '';
        defaults[STORAGE.cookie]   = '';
        defaults[STORAGE.status]   = 'guest';
        defaults[STORAGE.proxy]    = '';
        defaults[STORAGE.bridge]   = '';
        defaults[STORAGE.token]    = '';
        // Миграция с 1.0.x: ранее сохранялись пароль и cookie чужого origin.
        if (!Lampa.Storage.get('rezka_migrated_110', false)) {
            Lampa.Storage.set(STORAGE.cookie, '');
            Lampa.Storage.set(STORAGE.password, '');
            Lampa.Storage.set(STORAGE.status, 'guest');
            Lampa.Storage.set('rezka_migrated_110', true);
        }
        // Existing installations may still contain passwords from older versions.
        // Never retain a password in persistent Lampa settings.
        Lampa.Storage.set(STORAGE.password, '');
        Object.keys(defaults).forEach(function (k) {
            try {
                var cur = Lampa.Storage.get(k, '__none__');
                if (cur === '__none__' || cur === null || cur === undefined) {
                    Lampa.Storage.set(k, defaults[k]);
                }
            } catch (err) {}
        });
    }

    /* ====================================================
     *  Helpers
     * ==================================================== */
    function getDomain() {
        var d = (Lampa.Storage.get(STORAGE.domain) || 'https://rezka.fi').trim();
        if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
        return d.replace(/\/+$/, '');
    }

    function getCookie() {
        return (Lampa.Storage.get(STORAGE.cookie) || '').trim();
    }

    function isLoggedIn() {
        return Lampa.Storage.get(STORAGE.status) === 'logged';
    }

    function buildHeaders(extra) {
        // Forbidden and non-simple cross-origin headers cause WebKit preflight/failure.
        var headers = { 'Accept': 'text/html, text/plain, application/json, */*' };
        // Браузер сам отправляет cookies HDRezka; вручную заголовок Cookie запрещён.
        if (extra) for (var k in extra) headers[k] = extra[k];
        return headers;
    }

    function getBridge() {
        return String(Lampa.Storage.get(STORAGE.bridge) || '').trim().replace(/\/+$/, '');
    }
    function getBridgeToken() {
        return String(Lampa.Storage.get(STORAGE.token) || '').trim();
    }
    function bridgeURL(path) {
        return getBridge() + '/' + String(path).replace(/^\/+/, '');
    }
    function bridgeRequest(url, post, success, error) {
        var endpoint = getBridge();
        var token = getBridgeToken();
        if (!/^https:\/\/[^/]+/i.test(endpoint)) {
            error('Укажи HTTPS-адрес личного шлюза');
            return { abort: function () {} };
        }
        if (token.length < 32) {
            error('Не задан токен шлюза (не менее 32 символов)');
            return { abort: function () {} };
        }
        var xhr = new XMLHttpRequest();
        var sent = false;
        function fail(message) {
            if (!sent) { sent = true; error(message); }
        }
        try {
            xhr.open(post === false || post == null ? 'GET' : 'POST', url, true);
            xhr.timeout = 20000;
            xhr.setRequestHeader('X-Rezka-Bridge-Token', token);
            if (post !== false && post != null) {
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            }
            xhr.onload = function () {
                if (sent) return;
                if (xhr.status < 200 || xhr.status >= 300) {
                    var message = 'Шлюз HTTP ' + xhr.status;
                    try {
                        var result = JSON.parse(xhr.responseText);
                        message = result.error || result.detail || message;
                    } catch (ignore) {}
                    fail(message); return;
                }
                sent = true;
                success(xhr.responseText || '');
            };
            xhr.onerror = function () { fail('Не удаётся подключиться к шлюзу: проверь HTTPS и CORS'); };
            xhr.ontimeout = function () { fail('Таймаут подключения к шлюзу'); };
            xhr.send(post === false || post == null ? null : post);
        } catch (ex) { fail(ex.message || 'Ошибка подключения'); }
        return { abort: function () { sent = true; xhr.abort(); } };
    }
    function proxify(url) {
        if (getBridge()) return bridgeURL('/v1/proxy?url=' + encodeURIComponent(url));
        var p = String(Lampa.Storage.get(STORAGE.proxy) || '').trim();
        if (!p) return url;
        if (p.slice(-1) !== '/') p += '/';
        return p + url;
    }

    /**
     * HDREZKA "trash list" decoder for video URL (#h<base64-with-trash> payload).
     * 1:1 with the canonical algorithm used in nb557/online_mod and HdRezkaApi.
     */
    function decodeTrash(data) {
        if (!data || typeof data !== 'string') return data;
        if (data.charAt(0) !== '#') return data;

        // Сервер вставляет base64-версии этих строк, предварённых //_//
        var trashList = ['$$!!@$$@^!@#$$@', '@@@@@!##!^^^', '####^!!##!@@', '^^^!@##!!##', '$$#!!@#!@##'];

        // Аналог браузерного btoa() для UTF-8 строк
        function enc(str) {
            return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
                function (m, p1) { return String.fromCharCode(parseInt(p1, 16)); }));
        }
        function dec(str) {
            return decodeURIComponent(atob(str).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
        }
        function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

        var x = data.substring(2); // убираем ведущие два символа (обычно "#h")
        trashList.forEach(function (t) {
            var token = '//_//' + enc(t);
            // все вхождения, а не только первое
            x = x.split(token).join('');
        });
        try { return dec(x); } catch (e) {
            try { return atob(x); } catch (e2) { return ''; }
        }
    }

    /**
     * Parse the HDREZKA playlist string returned by /ajax/get_cdn_series/.
     * Format (after decode): [1080p Ultra]https://x/1080.mp4 or https://x/1080.mp4,[720p]...
     */
    function parsePlaylist(str) {
        if (!str) return [];
        var result = [];
        var parts = str.split(',');
        parts.forEach(function (part) {
            var m = part.match(/\[([^\]]+)\](.+)/);
            if (!m) return;
            var label = m[1].trim();
            var urls = m[2].split(' or ');
            // last URL is usually the highest-quality / mp4 fallback
            var file = urls[urls.length - 1].trim();
            result.push({ label: label, file: file });
        });
        return result;
    }

    /**
     * Network helper – wraps Lampa.Reguest / native fetch.
     */
    function request(opts, success, error) {
        if (getBridge()) return bridgeRequest(opts.url, opts.post || false, success, error);
        var network = new Lampa.Reguest();
        network.timeout(15000);
        network.silent(opts.url, function (resp) {
            success(resp);
        }, function (a, b) {
            error(a, b);
        }, opts.post || false, {
            dataType: opts.dataType || 'text',
            headers: buildHeaders(opts.headers)
        });
        return network;
    }

    /* ====================================================
     *  Auth: login to HDREZKA
     * ==================================================== */
    function authenticate(login, password, cb) {
        if (getBridge()) {
            var fields = 'login=' + encodeURIComponent(login) + '&password=' + encodeURIComponent(password);
            bridgeRequest(bridgeURL('/v1/login'), fields, function (response) {
                var result;
                try { result = JSON.parse(response); } catch (error) {
                    Lampa.Storage.set(STORAGE.status, 'error:invalid bridge response');
                    cb(false, 'Шлюз вернул некорректный JSON'); return;
                }
                if (!result.ok || !result.authenticated) {
                    Lampa.Storage.set(STORAGE.status, 'error:not authorized');
                    cb(false, result.error || 'Сессия не подтверждена'); return;
                }
                Lampa.Storage.set(STORAGE.status, 'logged');
                cb(true, 'Авторизация через личный шлюз подтверждена');
            }, function (message) {
                Lampa.Storage.set(STORAGE.status, 'error:' + message);
                cb(false, message);
            });
            return;
        }
        var proxy = String(Lampa.Storage.get(STORAGE.proxy) || '').trim();
        if (!/^https:\/\//i.test(getDomain()) || (proxy && !/^https:\/\//i.test(proxy))) {
            cb(false, 'Для авторизации нужен HTTPS у зеркала и прокси');
            return;
        }
        var endpoint = proxify(getDomain() + '/ajax/login/?t=' + Date.now());
        var post = 'login_name=' + encodeURIComponent(login) +
            '&login_password=' + encodeURIComponent(password) + '&login_not_save=0';
        // Передаём пароль только в POST, никогда не кладём в Lampa.Storage.
        var network = new Lampa.Reguest();
        var completed = false;
        function finish(ok, message) {
            if (completed) return;
            completed = true;
            Lampa.Storage.set(STORAGE.password, '');
            Lampa.Storage.set(STORAGE.status, ok ? 'logged' : 'error:' + message);
            cb(ok, message);
        }
        function verifySession() {
            rezkaFetchFavorites('/favorites/', function (error, html) {
                if (error) {
                    finish(false, 'Вход принят, но избранное недоступно: ' + error);
                    return;
                }
                var parsed = rezkaParseFavorites(html, 1);
                if (parsed.error) {
                    finish(false, 'Вход принят, но сессия не подтверждена: ' + parsed.error);
                    return;
                }
                finish(true, 'Сессия подтверждена, избранное доступно');
            });
        }
        try {
            network.timeout(15000);
            network.silent(endpoint, function (response) {
                var json = response;
                if (typeof json === 'string') {
                    try { json = JSON.parse(json); }
                    catch (error) {
                        finish(false, 'Ответ не JSON: зеркало или Cloudflare блокирует вход');
                        return;
                    }
                }
                if (!json || !(json.success || json.message ===
                    'Уже авторизован на сайте. Необходимо обновить страницу!')) {
                    finish(false, json && json.message || 'HDRezka отклонила запрос входа');
                    return;
                }
                verifySession();
            }, function (error) {
                var detail = error && (error.status || error.message) || '';
                finish(false, 'Сетевая ошибка/CORS' + (detail ? ' (' + detail + ')' : '') +
                    '. На iOS требуется доступное зеркало или доверенный HTTPS-сервер для запросов');
            }, post, {
                dataType: 'text',
                withCredentials: true,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
        } catch (error) {
            finish(false, error.message || 'Не удалось выполнить запрос');
        }
    }

    function logout() {
        Lampa.Storage.set(STORAGE.cookie, '');
        Lampa.Storage.set(STORAGE.password, '');
        Lampa.Storage.set(STORAGE.status, 'guest');
    }

    /* ====================================================
     *  Search on HDREZKA
     *  GET /engine/ajax/search.php?q=<title>
     * ==================================================== */
    function searchRezka(query, year, cb) {
        var url = proxify(getDomain() + '/engine/ajax/search.php?q=' + encodeURIComponent(query));
        request({ url: url }, function (html) {
            // <li><a href="..."><span class="enty">Title</span> (Original, 2023)<span class="rating">8.50</span></a></li>
            var div = document.createElement('div');
            div.innerHTML = html;
            var items = [];
            div.querySelectorAll('a').forEach(function (a) {
                var href = a.getAttribute('href');
                if (!href || href.indexOf('search') !== -1) return;
                // Основное название — из .enty (русский вариант)
                var entyEl = a.querySelector('.enty');
                var title = entyEl ? (entyEl.textContent || '').trim() : '';
                // Полный текст (содержит и оригинал, и год, и рейтинг)
                var fullText = (a.textContent || '').trim();
                if (!title) {
                    // без .enty — берём всю строку до «(слово, год)»
                    title = fullText.replace(/\s*\([^)]*\d{4}\)[\s\S]*$/, '').trim();
                }
                // Год — из любого вхождения (4 цифры 19xx/20xx)
                var ym = fullText.match(/\b(19|20)\d{2}\b/);
                items.push({
                    url: href,
                    title: title,
                    year: ym ? ym[0] : ''
                });
            });
            // если знаем год — предпочитаем точное совпадение
            if (year) {
                var exact = items.filter(function (i) { return i.year == String(year); });
                if (exact.length) items = exact;
            }
            cb(items);
        }, function () { cb([]); });
    }

    /* ====================================================
     *  Parse film page → translators / seasons / film_id
     * ==================================================== */
    function rezkaParseTranslators(html, defaultId, camrip, ads, director) {
        var voices = [];
        var seen = {};
        try {
            var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
            // Current HDRezka markup: #translators-list > li[data-translator_id].
            // Older mirrors used .b-translator__list. Handle both.
            var list = doc.getElementById('translators-list') ||
                doc.querySelector('.b-translator__list');
            var nodes = list ? list.querySelectorAll('[data-translator_id]') :
                doc.querySelectorAll('li.b-translator__item[data-translator_id]');
            for (var i = 0; i < nodes.length; i++) {
                var item = nodes[i];
                var id = String(item.getAttribute('data-translator_id') || '').trim();
                if (!/^\d+$/.test(id) || seen[id]) continue;
                var name = String(item.getAttribute('title') ||
                    item.textContent || '').replace(/\s+/g, ' ').trim();
                if (!name) continue;
                seen[id] = true;
                // HDRezka itself marks subscription-only dubbing options with
                // b-prem_translator; do not infer paid access from studio names.
                var classes = String(item.getAttribute('class') || '');
                var premium = /(?:^|\s)b-prem_translator(?:\s|$)/.test(classes);
                voices.push({
                    id: id,
                    name: name,
                    premium: premium,
                    is_camrip: item.getAttribute('data-camrip') || camrip || '0',
                    is_ads: item.getAttribute('data-ads') || ads || '0',
                    is_director: item.getAttribute('data-director') || director || '0'
                });
            }
        } catch (error) {
            console.log('REZKA', 'translator list parsing error', error && error.message);
        }
        return voices;
    }

    function fetchFilmPage(filmUrl, cb, err) {
        request({ url: proxify(rezkaSiteURL(filmUrl) || filmUrl), dataType: 'text' }, function (str) {
            var info = {
                film_id: '',
                is_series: false,
                favs: '',
                voice: [],   // [{name, id, is_camrip, is_ads, is_director}]
                season: [],  // [{name, id}]
                episode: [], // [{name, season_id, episode_id}]
                page_url: filmUrl
            };

            // film id
            // The mirror may return camera/advertising flags larger than 1.
            // Previous [01] restriction rejected valid player markup as unparseable.
            var idm = str.match(/initCDN(?:Series|Movies)Events\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?/);
            if (!idm) {
                // Compatible with other mirrors that expose only ID and translator ID.
                idm = str.match(/initCDN(?:Series|Movies)Events\s*\(\s*(\d+)\s*,\s*(\d+)/);
            }
            if (idm) {
                info.film_id = idm[1];
                var defVoiceId = idm[2];
                info.is_series = /initCDNSeriesEvents/.test(str);
                var camrip = idm[3], ads = idm[4], director = idm[5] || '0';

                // favs hash
                var fm = str.match(/var\s+sof\s*=.*?\.send\([^,]+,\s*'([^']+)'/);
                if (!fm) fm = str.match(/data-favs="([^"]+)"/);
                if (fm) info.favs = fm[1];

                // HDRezka currently renders voices in #translators-list.
                info.voice = rezkaParseTranslators(str, defVoiceId, camrip, ads, director);
                info.default_voice_id = String(defVoiceId);
                if (!info.voice.length) {
                    var defName = '';
                    var dn = str.match(/<h2>В переводе<\/h2>:[\s\S]*?<td[^>]*>(.*?)<\/td>/);
                    if (dn) {
                        var dd = document.createElement('div'); dd.innerHTML = dn[1];
                        defName = (dd.textContent || '').trim();
                    }
                    info.voice.push({
                        name: defName || 'Перевод по умолчанию',
                        id: defVoiceId,
                        premium: false,
                        is_camrip: camrip, is_ads: ads, is_director: director
                    });
                }

                if (info.is_series) {
                    var sm = str.match(/<ul\b[^>]*class=["'][^"']*\bb-simple_seasons__list\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/i);
                    if (sm) {
                        var ds = document.createElement('div'); ds.innerHTML = sm[0];
                        ds.querySelectorAll('.b-simple_season__item').forEach(function (li) {
                            info.season.push({
                                name: (li.textContent || '').trim(),
                                id: li.getAttribute('data-tab_id')
                            });
                        });
                    }
                    var em = str.match(/<ul\b[^>]*class=["'][^"']*\bb-simple_episodes__list\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi);
                    if (em) {
                        em.forEach(function (block) {
                            var de = document.createElement('div'); de.innerHTML = block;
                            de.querySelectorAll('.b-simple_episode__item').forEach(function (li) {
                                info.episode.push({
                                    name: (li.textContent || '').trim(),
                                    season_id: li.getAttribute('data-season_id'),
                                    episode_id: li.getAttribute('data-episode_id')
                                });
                            });
                        });
                    }
                }
                cb(info);
            } else {
                if (/<title[^>]*>\s*(?:Вход|Login)/i.test(str) || /id=["']loginForm["']/.test(str)) {
                    err && err('HDRezka вернула страницу входа вместо плеера. Проверь сессию.');
                } else if (/just a moment|cf-challenge|checking your browser/i.test(str)) {
                    err && err('HDRezka заблокировала загрузку плеера проверкой браузера.');
                } else {
                    err && err('Не удалось определить ID плеера на странице HDRezka.');
                }
            }
        }, function (error) {
            err && err(typeof error === 'string' ? error : 'Сетевая ошибка при загрузке страницы');
        });
    }

    /* ====================================================
     *  Get direct stream url
     *  POST /ajax/get_cdn_series/  (action=get_movie | get_stream)
     * ==================================================== */
    function getStream(info, voice, season, episode, cb, err) {
        var url = proxify(getDomain() + '/ajax/get_cdn_series/?t=' + Date.now());
        var post;
        if (info.is_series && season && episode) {
            post = 'id=' + encodeURIComponent(info.film_id) +
                   '&translator_id=' + encodeURIComponent(voice.id) +
                   '&season=' + encodeURIComponent(season.id) +
                   '&episode=' + encodeURIComponent(episode.episode_id) +
                   '&favs=' + encodeURIComponent(info.favs || '') +
                   '&action=get_stream';
        } else {
            post = 'id=' + encodeURIComponent(info.film_id) +
                   '&translator_id=' + encodeURIComponent(voice.id) +
                   '&is_camrip=' + encodeURIComponent(voice.is_camrip || 0) +
                   '&is_ads=' + encodeURIComponent(voice.is_ads || 0) +
                   '&is_director=' + encodeURIComponent(voice.is_director || 0) +
                   '&favs=' + encodeURIComponent(info.favs || '') +
                   '&action=get_movie';
        }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            if (getBridge()) xhr.setRequestHeader('X-Rezka-Bridge-Token', getBridgeToken());
            else xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.withCredentials = !getBridge();
            xhr.timeout = 15000;
            xhr.onload = function () {
                try {
                    var json = JSON.parse(xhr.responseText);
                    if (!json.success) { err && err(json.message || 'Сервер вернул ошибку'); return; }
                    var decoded = decodeTrash(json.url);
                    var items = parsePlaylist(decoded);
                    if (!items.length) { err && err('Пустой плейлист'); return; }
                    var qualities = {};
                    items.forEach(function (it) { qualities[it.label] = it.file; });
                    if (json.premium_content) {
                        // premium URLs are dummies for free accounts
                        // but we still try to play in case the user has premium
                    }
                    cb({
                        title: '',
                        file: items[items.length - 1].file, // best (last)
                        quality: qualities,
                        subtitles: parseSubtitles(json.subtitle)
                    });
                } catch (e) { err && err('Не удалось разобрать ответ'); }
            };
            xhr.onerror = function () { err && err('Сетевая ошибка'); };
            xhr.ontimeout = function () { err && err('Таймаут'); };
            xhr.send(post);
        } catch (e) { err && err(e.message); }
    }

    function parseSubtitles(s) {
        if (!s || typeof s !== 'string') return [];
        // format: "[lang]url,[lang2]url2,..."
        return s.split(',').map(function (part) {
            var m = part.match(/\[([^\]]+)\](.+)/);
            return m ? { label: m[1], url: m[2] } : null;
        }).filter(Boolean);
    }

    /* ====================================================
     * Cross-device playback progress (own Netlify, separate from HDRezka).
     * External players only report launch, not watched/time position.
     * ==================================================== */
    var rezkaWatchActive = null;
    function rezkaWatchRequest(method, data, success, error) {
        if (!getBridge() || !getBridgeToken()) {
            if (error) error('Для синхронизации нужен личный HTTPS-шлюз');
            return { abort: function () {} };
        }
        var xhr = new XMLHttpRequest();
        var done = false;
        try {
            xhr.open(method, bridgeURL('/v1/watch/progress'), true);
            xhr.timeout = 15000;
            xhr.setRequestHeader('X-Rezka-Bridge-Token', getBridgeToken());
            if (method === 'POST') xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function () {
                if (done) return;
                done = true;
                if (xhr.status < 200 || xhr.status >= 300) {
                    if (error) error('HTTP ' + xhr.status);
                    return;
                }
                try {
                    if (success) success(JSON.parse(xhr.responseText));
                } catch (e) {
                    if (error) error('Некорректный ответ хранилища');
                }
            };
            xhr.onerror = function () { if (!done && error) error('Нет связи с синхронизацией'); };
            xhr.ontimeout = function () { if (!done && error) error('Таймаут синхронизации'); };
            xhr.send(method === 'POST' ? JSON.stringify(data) : null);
        } catch (e) { if (error) error(e.message || 'Ошибка синхронизации'); }
        return { abort: function () { done = true; xhr.abort(); } };
    }
    function rezkaWatchRead(done, error) {
        return rezkaWatchRequest('GET', null, function (data) {
            done(data && Array.isArray(data.items) ? data.items : []);
        }, error);
    }
    function rezkaWatchSave(item) {
        if (!getBridge()) return;
        rezkaWatchRequest('POST', item, function () {}, function (message) {
            console.log('REZKA', 'Watch save:', message);
        });
    }
    function rezkaWatchLaunch(info, movie, voice, season, episode, stream) {
        if (!getBridge()) return;
        var title = String(movie && (movie.title || movie.name) || '').trim();
        if (!title) return;
        var url = rezkaSiteURL(info.page_url);
        if (!url) return;
        rezkaWatchActive = {
            url: url, title: title,
            poster: movie.rezka_poster || '',
            season: season ? String(season.id) : '',
            episode: episode ? String(episode.episode_id) : '',
            translator: voice ? String(voice.id) : '',
            voice: voice ? String(voice.name) : '',
            position: 0, duration: 0, status: 'started',
            stream: stream, startedAt: Date.now(),
            lastSent: 0, resume: Number(movie.rezka_resume_position) || 0,
            finished: false
        };
        rezkaWatchSave(rezkaWatchActive);
    }
    function rezkaWatchInstall() {
        if (!Lampa.Player || !Lampa.Player.listener || !Lampa.Player.listener.follow) return;
        Lampa.Player.listener.follow('start', function (data) {
            var current = rezkaWatchActive;
            if (!current || Date.now() - current.startedAt > 120000) return;
            if (data && data.url && current.stream && data.url !== current.stream) return;
            if (!Lampa.PlayerVideo || !Lampa.PlayerVideo.listener ||
                !Lampa.PlayerVideo.listener.follow) return;
            var events = Lampa.PlayerVideo.listener;
            var closed = false;
            var seeked = false;
            function updateTime(e) {
                if (closed || !e) return;
                var seconds = Number(e.current);
                var duration = Number(e.duration);
                if (isFinite(seconds) && seconds >= 0 && seconds < 86400)
                    current.position = Math.round(seconds);
                if (isFinite(duration) && duration > 0 && duration < 86400)
                    current.duration = Math.round(duration);
                if (current.duration && current.position >= current.duration * 0.9)
                    current.status = 'completed';
                else current.status = 'progress';
                if (Date.now() - current.lastSent >= 20000) {
                    current.lastSent = Date.now();
                    rezkaWatchSave(current);
                }
            }
            function pause() {
                if (!closed && !current.finished) rezkaWatchSave(current);
            }
            function ended() {
                if (closed) return;
                current.status = 'completed';
                current.finished = true;
                if (current.duration) current.position = current.duration;
                rezkaWatchSave(current);
            }
            function attemptSeek() {
                if (closed || seeked || current.resume < 10) return;
                try {
                    var video = Lampa.PlayerVideo.video;
                    if (video && video.jquery) video = video[0];
                    if (video && typeof video.currentTime === 'number' &&
                        (!video.duration || current.resume < video.duration - 5)) {
                        video.currentTime = current.resume;
                        seeked = true;
                    }
                } catch (ignore) {}
            }
            function stop() {
                if (closed) return;
                closed = true;
                if (!current.finished) rezkaWatchSave(current);
                if (events.remove) {
                    events.remove('timeupdate', updateTime);
                    events.remove('pause', pause);
                    events.remove('ended', ended);
                    events.remove('canplay', attemptSeek);
                }
                if (Lampa.Player.listener.remove) Lampa.Player.listener.remove('destroy', stop);
                if (rezkaWatchActive === current) rezkaWatchActive = null;
            }
            events.follow('timeupdate', updateTime);
            events.follow('pause', pause);
            events.follow('ended', ended);
            events.follow('canplay', attemptSeek);
            Lampa.Player.listener.follow('destroy', stop);
        });
    }

    /* ====================================================
     *  Lampa Online component
     * ==================================================== */
    function component(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var html = $('<div></div>');

        var state = {
            info: null,
            choice: { voice: 0, season: 0 }
        };
        var onlineInitialized = false;
        var onlineDestroyed = false;

        this.create = function () {
            scroll.minus();
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());

            filter.onSearch = function (value) {
                Lampa.Activity.replace({ search: value, clarification: true });
            };
            filter.onBack = function () { self.start(); };

            return this.render();
        };

        this.render = function () { return files.render(); };

        var self = this;

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            if (!onlineInitialized) {
                onlineInitialized = true;
                try {
                    this.initialize();
                } catch (initError) {
                    console.log('REZKA', 'online initialize error', initError);
                    this.activity.loader(false);
                    showError('HDRezka: ' + (initError.message || initError));
                    this.activity.toggle();
                }
            }
            if (object.movie && Lampa.Background && Lampa.Background.immediately &&
                Lampa.Utils && Lampa.Utils.cardImgBackgroundBlur) {
                Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
            }
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { Navigator.move('down'); },
                left: function () { Lampa.Controller.toggle('menu'); },
                right: function () { Navigator.move('right'); },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.back = function () { Lampa.Activity.backward(); };
        this.destroy = function () {
            onlineDestroyed = true;
            network.clear();
            scroll.destroy();
            files.destroy();
            filter.destroy();
            html.remove();
        };

        // search & render flow ---------------------------------
        function showError(msg) {
            if (onlineDestroyed) return;
            html.empty();
            if (Lampa.Empty) {
                try {
                    var empty = new Lampa.Empty({ text: msg });
                    html.append(empty.render());
                } catch (e) { $('<div class="rezka-fav-msg"></div>').text(msg).appendTo(html); }
            } else $('<div class="rezka-fav-msg"></div>').text(msg).appendTo(html);
            scroll.append(html);
            if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('HDRezka: ' + msg);
        }

        function rezkaVoiceLabel(voice) {
            if (!voice) return '';
            return String(voice.name || '') + (voice.premium ? ' · 🔒 Premium' : '');
        }

        function buildList() {
            html.empty();
            if (!state.info) return;
            var info = state.info;

            var voice = info.voice[state.choice.voice] || info.voice[0];
            var season = info.season[state.choice.season];

            var items = [];
            if (info.is_series) {
                if (!season) {
                    showError('Не удалось определить сезоны сериала на HDRezka');
                    return;
                }
                items = info.episode.filter(function (e) { return String(e.season_id) === String(season.id); });
                if (!items.length) {
                    showError('Список серий не найден на странице HDRezka');
                    return;
                }
            } else {
                items = [{ name: 'Смотреть фильм', episode_id: 0, season_id: 0, _movie: true }];
            }

            items.forEach(function (ep) {
                // Lampa.Utils.escape does not exist in standard Lampa.
                // jQuery.text() safely escapes HTML, including untrusted episode names.
                var item = $('<div class="online selector"></div>');
                $('<div class="online__title"></div>').text(String(ep.name || '')).appendTo(item);
                $('<div class="online__quality"></div>').text(rezkaVoiceLabel(voice)).appendTo(item);
                item.on('hover:enter', function () {
                    Lampa.Modal.open({
                        title: 'HDREZKA',
                        html: $('<div style="padding:1em">Получаем ссылку…</div>'),
                        size: 'small',
                        onBack: function () { Lampa.Modal.close(); Lampa.Controller.toggle('content'); }
                    });
                    getStream(info, voice,
                        info.is_series ? season : null,
                        info.is_series ? ep : null,
                        function (data) {
                            Lampa.Modal.close();
                            rezkaWatchLaunch(info, object.movie || {}, voice,
                                info.is_series ? season : null,
                                info.is_series ? ep : null, data.file);
                            Lampa.Player.play({
                                url: data.file,
                                title: object.movie.title || object.movie.name || '',
                                quality: data.quality,
                                subtitles: data.subtitles
                            });
                            Lampa.Player.playlist([{
                                url: data.file,
                                title: object.movie.title || object.movie.name || '',
                                quality: data.quality,
                                subtitles: data.subtitles
                            }]);
                        },
                        function (msg) {
                            Lampa.Modal.close();
                            Lampa.Noty.show('HDREZKA: ' + msg);
                        });
                });
                html.append(item);
            });
            scroll.append(html);
            Lampa.Controller.enable('content');
        }

        function buildFilter() {
            if (!state.info) return;
            var info = state.info;
            var f = {
                voice: info.voice.map(function (v) { return rezkaVoiceLabel(v); })
            };
            if (info.is_series) {
                f.season = info.season.map(function (s) { return s.name; });
            }
            filter.set('filter', Object.keys(f).map(function (key) {
                return {
                    title: key === 'voice' ? 'Перевод' : 'Сезон',
                    subtitle: f[key][state.choice[key]] || '—',
                    stype: key,
                    noselect: true,
                    items: f[key].map(function (label, index) {
                        return { title: label, index: index, selected: index === state.choice[key] };
                    })
                };
            }));
            filter.onSelect = function (type, a, b) {
                if (type !== 'filter' || !a || !a.stype || !b || typeof b.index !== 'number') return;
                state.choice[a.stype] = b.index;
                buildFilter();
                try { buildList(); }
                catch (renderError) {
                    console.log('REZKA', 'HDRezka player render failed', renderError);
                    showError('Ошибка отображения серий: ' + (renderError.message || renderError));
                }
            };
        }

        this.initialize = function () {
            this.activity.loader(true);
            var movie = object.movie || {};
            var title = movie.title || movie.name || '';
            var year = String(movie.release_date || movie.first_air_date || movie.year || '').slice(0, 4);
            function load(url) {
                fetchFilmPage(url, function (info) {
                    if (onlineDestroyed) return;
                    state.info = info;
                    // Preserve HDRezka's initially selected translator rather than assuming index 0.
                    var defaultIndex = info.voice.findIndex(function (v) {
                        return String(v.id) === String(info.default_voice_id);
                    });
                    state.choice.voice = defaultIndex >= 0 ? defaultIndex : 0;
                    self.activity.loader(false);
                    try {
                        buildFilter();
                        buildList();
                    } catch (renderError) {
                        console.log('REZKA', 'player render error', renderError);
                        showError('Ошибка отображения плеера: ' + (renderError.message || renderError));
                    }
                    self.activity.toggle();
                }, function (msg) {
                    if (onlineDestroyed) return;
                    self.activity.loader(false);
                    showError(msg);
                    self.activity.toggle();
                });
            }
            // Сохранённая ссылка HDRezka точнее поиска по названию.
            if (movie.rezka_url) {
                var direct = rezkaSiteURL(movie.rezka_url);
                if (direct) { load(direct); return; }
            }
            searchRezka(title, year, function (items) {
                if (onlineDestroyed) return;
                if (!items.length) {
                    self.activity.loader(false);
                    showError('Ничего не найдено на HDREZKA');
                    self.activity.toggle();
                    return;
                }
                load(items[0].url);
            });
        };
    }

    /* ====================================================
     *  Register component & online source button
     * ==================================================== */
    function registerComponent() {
        if (Lampa.Component && Lampa.Component.add) {
            Lampa.Component.add('rezka_online', component);
        }
    }

    function openRezka(movie) {
        Lampa.Activity.push({
            url: '',
            title: 'HDREZKA - ' + (movie.title || movie.name || ''),
            component: 'rezka_online',
            movie: movie,
            page: 1
        });
    }

    function addOnlineSource() {
        // Регистрация в Lampa.Online (источник в стандартной кнопке «Онлайн»)
        var source = {
            title: 'HDREZKA',
            search: function (movie, oncomplite) {
                openRezka(movie);
                oncomplite && oncomplite([]);
            },
            onContextMenu: function () { return { name: 'HDREZKA' }; }
        };
        if (Lampa.Online && Lampa.Online.register) {
            Lampa.Online.register('rezka', source);
        }
    }

    /* ====================================================
     *  Кнопка «HDREZKA» прямо в карточке фильма (рядом со «Смотреть»)
     *  Срабатывает на событии full → complite, когда карточка отрисована.
     * ==================================================== */
    function addCardButton() {
        // Inline-стили для кнопки (Lampa использует свои классы, мы
        // дополнительно добавляем минимальный CSS на случай отсутствия темы)
        var styleId = 'rezka-plugin-style';
        if (!document.getElementById(styleId)) {
            var st = document.createElement('style');
            st.id = styleId;
            st.innerHTML =
                '.full-start__button.view--rezka{background:linear-gradient(135deg,#1d8a3a,#0f5e25);color:#fff}' +
                '.full-start-new__buttons .view--rezka,.full-start__buttons .view--rezka{order:-1}' +
                '.view--rezka .button__icon{margin-right:.4em}';
            document.head.appendChild(st);
        }

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var root = e.object.activity.render();
            // Поддерживаем разные темы карточки: новую и классическую
            var btnContainer = root.find('.full-start-new__buttons');
            if (!btnContainer.length) btnContainer = root.find('.full-start__buttons');
            if (!btnContainer.length) return;
            if (root.find('.view--rezka').length) return; // уже добавлена

            var label = '<svg class="button__icon" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M9 8l6 4-6 4V8z" fill="currentColor"/></svg>' +
                '<span>HDREZKA</span>';

            var btn = $(
                '<div class="full-start__button selector view--online view--rezka">' + label + '</div>'
            );

            btn.on('hover:enter', function () { openRezka(e.data.movie); });

            // Помещаем кнопку ПЕРВОЙ — слева от «Смотреть» / «Онлайн»
            btnContainer.prepend(btn);

            // Делаем эту кнопку активной по умолчанию (фокус под указателем).
            // Lampa перестроит навигацию после prepend, поэтому нужно немного подождать.
            setTimeout(function () {
                try {
                    if (Navigator && Navigator.focused) {
                        Navigator.focused(btn[0]);
                    } else {
                        Lampa.Controller.collectionFocus(btn[0], root);
                    }
                } catch (err) {
                    // На некоторых сборках Navigator может быть недоступен
                    btn.addClass('focus');
                }
            }, 50);
        });
    }


    /* ====================================================
     * HDRezka Favorites: collections and items from /favorites/
     * ==================================================== */
    function rezkaSiteURL(href) {
        try {
            var root = new URL(getDomain());
            var url = new URL(String(href || ''), root.href + '/');
            if (!/^https?:$/.test(url.protocol) || url.host !== root.host) return '';
            return url.href;
        } catch (e) { return ''; }
    }

    function rezkaPosterURL(href) {
        try {
            var url = new URL(String(href || ''), getDomain() + '/');
            return /^https?:$/.test(url.protocol) ? url.href : '';
        } catch (e) { return ''; }
    }

    function rezkaFetchFavorites(path, done) {
        var url = rezkaSiteURL(path);
        if (!url) { done('Некорректный адрес коллекции'); return null; }
        var net = new Lampa.Reguest();
        var canceled = false;
        try {
            net.timeout(15000);
            if (getBridge()) return bridgeRequest(proxify(url), false, function (result) {
                if (!canceled) done(null, result);
            }, function (message) { if (!canceled) done(message); });
            net.silent(proxify(url), function (result) {
                if (!canceled) done(null, typeof result === 'string' ? result : String(result || ''));
            }, function (err) {
                if (!canceled) {
                    var status = err && err.status || 0;
                    done(status ? 'HTTP/сеть ' + status :
                        'CORS или недоступное зеркало. На iOS может понадобиться доверенный HTTPS-прокси');
                }
            }, false, { dataType: 'text', withCredentials: true });
        } catch (e) { done(e.message || 'Ошибка запроса'); }
        return { abort: function () { canceled = true; if (net.clear) net.clear(); } };
    }

    function rezkaParseFavorites(html, page) {
        var out = { cats: [], items: [], next: false, error: '' };
        var doc;
        try { doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); }
        catch (e) { out.error = 'Ошибка HTML'; return out; }
        if (doc.querySelector('#challenge-form, .cf-challenge') ||
            /just a moment|checking your browser|attention required/i.test(doc.title || '')) {
            out.error = 'Cloudflare заблокировал страницу'; return out;
        }
        if (doc.querySelector('form[action*="login"] input[name="login_password"]')) {
            out.error = 'Сессия истекла, войдите повторно'; return out;
        }
        var categories = doc.querySelectorAll('a.b-favorites_content__cats_list_link');
        for (var i = 0; i < categories.length; i++) {
            var link = categories[i], url = rezkaSiteURL(link.getAttribute('href'));
            var id = url && new URL(url).pathname.match(/^\/favorites\/(\d+)\/?$/);
            if (!id) continue;
            var name = link.querySelector('.name'), count = link.querySelector('.num-holder');
            out.cats.push({ id: id[1], name: (name ? name.textContent : link.textContent).trim(),
                count: count ? count.textContent.trim() : '' });
        }
        var cards = doc.querySelectorAll('.b-content__inline_item');
        for (var j = 0; j < cards.length; j++) {
            var card = cards[j], a = card.querySelector('.b-content__inline_item-link a[href]');
            if (!a) continue;
            var href = rezkaSiteURL(a.getAttribute('href'));
            if (!href) continue;
            var picture = card.querySelector('.b-content__inline_item-cover img');
            var meta = card.querySelector('.b-content__inline_item-link div');
            var year = (meta && meta.textContent || '').match(/\b(?:19|20)\d{2}\b/);
            var title = (a.getAttribute('title') || a.textContent || '').trim();
            if (!title) continue;
            out.items.push({
                title: title, year: year ? year[0] : '', url: href,
                poster: picture ? rezkaPosterURL(picture.getAttribute('data-src') ||
                    picture.getAttribute('data-original') || picture.getAttribute('src')) : ''
            });
        }
        var links = doc.querySelectorAll('.b-navigation a[href], .b-pagination a[href]');
        for (var k = 0; k < links.length; k++) {
            var next = rezkaSiteURL(links[k].getAttribute('href'));
            if (next && new RegExp('/page/' + (page + 1) + '/?(?:$|[?#])').test(next)) {
                out.next = true; break;
            }
        }
        if (!doc.querySelector('.b-favorites_content, .b-favorites_content__cats_list_link, .b-content__inline_item') &&
            !doc.querySelector('a[href*="/logout/"], .b-header__user')) {
            out.error = 'Не удалось подтвердить доступ к избранному';
        }
        return out;
    }

    function rezkaFavoritesOpen(category, page) {
        Lampa.Activity.push({
            url: '', title: 'Избранное HDRezka', component: 'rezka_favorites',
            rezka_category: category || '', rezka_page: page || 1, page: 1
        });
    }

    function rezkaOpenLampaCard(item) {
        var name = String(item.title || '').trim();
        if (!name) { Lampa.Noty.show('HDRezka: отсутствует название'); return; }
        function fallback() { rezkaOpenLampaSearch(name); }
        if (!Lampa.Api || typeof Lampa.Api.search !== 'function') { fallback(); return; }

        function norm(value) {
            return String(value || '').toLowerCase().replace(/ё/g, 'е')
                .replace(/[^a-zа-я0-9]/g, '');
        }
        var target = norm(name);
        var targetYear = parseInt(item.year, 10) || 0;

        // Lampa.Api.search returns {movie:{results:[]}, tv:{results:[]}},
        // not {results:[]}. Preserve media type when opening the full card.
        Lampa.Api.search({ query: encodeURIComponent(name) }, function (answer) {
            var list = [];
            ['movie', 'tv'].forEach(function (kind) {
                var group = answer && answer[kind];
                var rows = group && group.results || [];
                rows.forEach(function (candidate) {
                    if (candidate && candidate.id) list.push({ data: candidate, kind: kind });
                });
            });
            var found = list.filter(function (entry) {
                var x = entry.data;
                var titles = [x.title, x.name, x.original_title, x.original_name];
                if (!titles.some(function (title) { return norm(title) === target; })) return false;
                var year = parseInt((x.release_date || x.first_air_date || '').slice(0, 4), 10);
                return !targetYear || !year || Math.abs(targetYear - year) <= 1;
            })[0];
            if (!found) { fallback(); return; }
            Lampa.Activity.push({
                url: found.kind + '/' + found.data.id,
                title: found.data.title || found.data.name || name,
                component: 'full', id: found.data.id,
                method: found.kind, source: 'tmdb', card: found.data, page: 1
            });
        });
    }

    function rezkaOpenLampaSearch(query) {
        if (Lampa.Search && Lampa.Search.open) Lampa.Search.open({ input: query });
        else Lampa.Activity.push({
            url: 'search/multi?query=' + encodeURIComponent(query),
            title: 'Поиск: ' + query, component: 'category_full',
            source: 'tmdb', page: 1
        });
    }

    function rezkaFavoritesComponent(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var explorer = new Lampa.Explorer(object);
        var html = $('<div class="rezka-fav-page"></div>');
        var xhr = null, destroyed = false, initialized = false, self = this;
        this.create = function () {
            scroll.minus();
            explorer.appendFiles(scroll.render());
            return this.render();
        };
        this.render = function () { return explorer.render(); };
        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            // Activity does not call initialize() for custom components.
            // Without this the page opens but never requests favorites.
            if (!initialized) {
                initialized = true;
                try {
                    this.initialize();
                } catch (error) {
                    console.log('REZKA', 'favorites initialize error', error);
                    finish('Не удалось открыть избранное: ' + (error.message || error));
                }
            }
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), explorer.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { Navigator.move('down'); },
                left: function () { Lampa.Controller.toggle('menu'); },
                right: function () { Navigator.move('right'); },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };
        this.pause = function () {};
        this.stop = function () {};
        this.back = function () { Lampa.Activity.backward(); };
        this.destroy = function () {
            destroyed = true;
            if (xhr) xhr.abort();
            scroll.destroy();
            explorer.destroy();
            html.remove();
        };
        function row(title, description, poster, click) {
            var e = $('<div class="online selector rezka-fav-row"></div>');
            if (poster) $('<img class="rezka-fav-cover" alt="">').attr('src', poster).appendTo(e);
            var info = $('<div></div>').appendTo(e);
            $('<div class="online__title"></div>').text(title).appendTo(info);
            if (description) $('<div class="online__quality"></div>').text(description).appendTo(info);
            e.on('hover:enter', click).appendTo(html);
        }
        function finish(message) {
            if (destroyed) return;
            if (message) {
                $('<div class="rezka-fav-msg"></div>').text(message).appendTo(html);
                if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('HDRezka: ' + message);
            }
            scroll.append(html);
            self.activity.loader(false);
            self.activity.toggle();
        }
        this.initialize = function () {
            self.activity.loader(true);
            var cat = object.rezka_category || '';
            var page = Math.max(1, parseInt(object.rezka_page, 10) || 1);
            var root = !cat;
            var path = '/favorites/' + (/^\d+$/.test(cat) ? cat + '/' : '');
            if (page > 1) path += 'page/' + page + '/';
            xhr = rezkaFetchFavorites(path, function (error, response) {
                if (destroyed) return;
                if (error) { finish(error); return; }
                var data;
                try { data = rezkaParseFavorites(response, page); }
                catch (parseError) {
                    finish('Ошибка обработки списка: ' + (parseError.message || parseError));
                    return;
                }
                if (data.error) {
                    Lampa.Storage.set(STORAGE.status, 'error:' + data.error);
                    finish(data.error); return;
                }
                Lampa.Storage.set(STORAGE.status, 'logged');
                if (root) {
                    if (data.items.length) row('Все избранное', 'Общий список', '', function () {
                        rezkaFavoritesOpen('all', 1);
                    });
                    data.cats.forEach(function (category) {
                        row(category.name, category.count ? category.count + ' элементов' : 'Коллекция', '', function () {
                            rezkaFavoritesOpen(category.id, 1);
                        });
                    });
                    finish(data.cats.length || data.items.length ? '' : 'В аккаунте нет избранного.');
                    return;
                }
                data.items.forEach(function (item) {
                    row(item.title, item.year, item.poster, function () {
                        Lampa.Select.show({
                            title: item.title,
                            items: [
                                { title: 'Смотреть на HDRezka', action: 'watch' },
                                { title: 'Открыть карточку Lampa', action: 'card' }
                            ],
                            onBack: function () { Lampa.Controller.toggle('content'); },
                            onSelect: function (selected) {
                                if (selected.action === 'card') rezkaOpenLampaCard(item);
                                else openRezka({ title: item.title, year: item.year, rezka_url: item.url });
                            }
                        });
                    });
                });
                if (page > 1) row('← Предыдущая страница', '', '', function () {
                    rezkaFavoritesOpen(cat, page - 1);
                });
                if (data.next) row('Следующая страница →', '', '', function () {
                    rezkaFavoritesOpen(cat, page + 1);
                });
                finish(data.items.length ? '' : 'Коллекция пуста.');
            });
        };
    }

    function rezkaFavoritesRegister() {
        Lampa.Component.add('rezka_favorites', rezkaFavoritesComponent);
        if (!document.getElementById('rezka-fav-style')) {
            var style = document.createElement('style');
            style.id = 'rezka-fav-style';
            style.textContent = '.rezka-fav-page{padding:.5em 0}' +
                '.rezka-fav-row{display:flex;align-items:center;gap:1em;min-height:4em}' +
                '.rezka-fav-cover{width:3.2em;height:4.7em;object-fit:cover;border-radius:.25em}' +
                '.rezka-fav-msg{padding:1em;opacity:.8}';
            document.head.appendChild(style);
        }
        if (Lampa.Menu && Lampa.Menu.addButton) {
            try { Lampa.Menu.addButton(
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>',
                'Избранное HDRezka', function () { rezkaFavoritesOpen('', 1); }
            ); } catch (error) { console.log('REZKA', 'menu error', error.message); }
        }
    }

    /* ====================================================
     *  Settings panel: domain / login / password / login
     * ==================================================== */
    function statusLabel() {
        var s = Lampa.Storage.get(STORAGE.status) || 'guest';
        if (s === 'logged') return '🟢 Вы вошли в аккаунт';
        if (s.indexOf('error:') === 0) return '🔴 Ошибка: ' + s.substring(6);
        return '⚪ Не авторизованы';
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'rezka',
            name: 'HDREZKA',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M4 4h16v16H4z" stroke="currentColor" stroke-width="2"/>' +
                '<path d="M9 8l6 4-6 4V8z" fill="currentColor"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: STORAGE.domain, type: 'input', values: '', default: 'https://rezka.fi' },
            field: { name: 'Домен HDREZKA', description: 'По умолчанию rezka.fi. Можно сменить на рабочее зеркало.' },
            onChange: function () { Lampa.Storage.set(STORAGE.status, 'guest'); }
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: STORAGE.login, type: 'input', values: '', default: '' },
            field: { name: 'Логин / E-mail', description: 'Email или имя пользователя HDREZKA' }
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: 'rezka_login_button', type: 'button' },
            field: { name: 'Войти в аккаунт', description: statusLabel() },
            onChange: function () {
                var login = String(Lampa.Storage.get(STORAGE.login) || '').trim();
                if (!login) {
                    Lampa.Noty.show('Сначала укажите логин HDRezka');
                    return;
                }
                if (!Lampa.Input || !Lampa.Input.edit) {
                    Lampa.Noty.show('В этой версии Lampa нет безопасного диалога ввода');
                    return;
                }
                Lampa.Input.edit({
                    value: '', title: 'Пароль HDRezka',
                    free: true, nosave: true
                }, function (password) {
                    if (!password) return;
                    Lampa.Noty.show('Проверяем соединение и авторизацию…');
                    authenticate(login, password, function (ok, msg) {
                        Lampa.Noty.show((ok ? '✓ ' : '✗ ') + msg);
                        $('[data-name="rezka_login_button"] .settings-param__descr')
                            .text(statusLabel());
                    });
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: 'rezka_logout_button', type: 'button' },
            field: { name: 'Выйти из аккаунта', description: 'Очистить локальный статус; серверную сессию это не закрывает' },
            onChange: function () {
                logout();
                if (getBridge()) {
                    bridgeRequest(bridgeURL('/v1/logout'), '', function () {
                        Lampa.Noty.show('Сессия личного шлюза закрыта');
                    }, function (message) {
                        Lampa.Noty.show('Локальный выход выполнен, шлюз: ' + message);
                    });
                } else Lampa.Noty.show('Локальный статус очищен. Cookie браузера могут остаться.');
                $('[data-name="rezka_login_button"] .settings-param__descr').text(statusLabel());
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: 'rezka_open_favorites', type: 'button' },
            field: { name: 'Открыть избранное HDRezka', description: 'Мои коллекции' },
            onChange: function () { rezkaFavoritesOpen('', 1); }
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: 'rezka_connection_check', type: 'button' },
            field: {
                name: 'Проверить связь с HDRezka',
                description: 'Проверка сети и CORS без отправки пароля'
            },
            onChange: function () {
                Lampa.Noty.show('Проверяем доступ к сайту HDRezka…');
                rezkaFetchFavorites('/favorites/', function (error, html) {
                    if (error) Lampa.Noty.show('HDRezka: ' + error);
                    else {
                        var parsed = rezkaParseFavorites(html, 1);
                        Lampa.Noty.show(parsed.error ?
                            'Сеть доступна; ' + parsed.error :
                            'Сеть и избранное доступны');
                    }
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: STORAGE.bridge, type: 'input', values: '', default: '' },
            field: { name: 'Личный HTTPS-шлюз',
                description: 'Адрес своего сервера, без /v1; например https://rezka.example.com' }
        });
        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: 'rezka_bridge_token_edit', type: 'button' },
            field: { name: 'Токен личного шлюза',
                description: getBridgeToken() ? 'Токен настроен (скрыт)' : 'Токен не задан' },
            onChange: function () {
                if (!Lampa.Input || !Lampa.Input.edit) return;
                Lampa.Input.edit({
                    value: '', title: 'Токен личного шлюза', free: true, nosave: true
                }, function (value) {
                    if (!value || String(value).trim().length < 32) {
                        Lampa.Noty.show('Токен должен содержать не менее 32 символов'); return;
                    }
                    Lampa.Storage.set(STORAGE.token, String(value).trim());
                    Lampa.Noty.show('Токен сохранён');
                    $('[data-name="rezka_bridge_token_edit"] .settings-param__descr')
                        .text('Токен настроен (скрыт)');
                });
            }
        });
        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: 'rezka_bridge_test', type: 'button' },
            field: { name: 'Проверить личный шлюз', description: 'Сессия, CORS и доступ к зеркалу' },
            onChange: function () {
                if (!getBridge()) {
                    Lampa.Noty.show('Сначала укажите адрес шлюза'); return;
                }
                bridgeRequest(bridgeURL('/v1/status'), false, function (response) {
                    var data;
                    try { data = JSON.parse(response); }
                    catch (ignore) { Lampa.Noty.show('Неверный ответ шлюза'); return; }
                    Lampa.Noty.show(data.authenticated ? 'HDRezka: сессия активна' :
                        data.gateway ? 'HDRezka: закрытое зеркало требует отдельного входа' :
                        data.cloudflare ? 'HDRezka: Cloudflare блокирует сервер' :
                        'Шлюз доступен; авторизация HDRezka не подтверждена');
                }, function (message) { Lampa.Noty.show('Шлюз: ' + message); });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'rezka',
            param: { name: STORAGE.proxy, type: 'input', values: '', default: '' },
            field: {
                name: 'CORS-прокси (опц.)',
                description: 'Устаревший режим. Для iPhone используй собственный HTTPS-шлюз выше'
            }
        });
    }

    /* ====================================================
     *  Bootstrap
     * ==================================================== */
    function registerManifest() {
        try {
            if (!Lampa.Manifest) Lampa.Manifest = {};
            // Старые билды: plugins — объект; новые: массив.
            if (Array.isArray(Lampa.Manifest.plugins)) {
                var already = Lampa.Manifest.plugins.some(function (p) {
                    return p && p.component === manifest.component;
                });
                if (!already) Lampa.Manifest.plugins.push(manifest);
            } else if (typeof Lampa.Manifest.plugins === 'object' && Lampa.Manifest.plugins) {
                Lampa.Manifest.plugins[manifest.component] = manifest;
            } else {
                // Поле отсутствует — создаём как объект (наиболее совместимый вариант)
                var box = {};
                box[manifest.component] = manifest;
                Lampa.Manifest.plugins = box;
            }
        } catch (err) {
            console.log('REZKA', 'manifest register failed', err && err.message);
        }
    }

    function startPlugin() {
        if (window.rezka_plugin_started) return;
        window.rezka_plugin_started = true;
        try {
            ensureDefaults();
            registerManifest();
            registerComponent();
            rezkaFavoritesRegister();
            addSettings();
            addOnlineSource();
            addCardButton();
            rezkaWatchInstall();
            console.log('REZKA', 'plugin started OK');
        } catch (err) {
            console.log('REZKA', 'startPlugin error:', err && (err.stack || err.message));
            if (typeof Lampa !== 'undefined' && Lampa.Noty && Lampa.Noty.show) {
                Lampa.Noty.show('HDREZKA: ошибка старта — ' + (err && err.message));
            }
        }
    }

    function bootstrap() {
        if (typeof Lampa === 'undefined') {
            // Lampa ещё не загружена — ждём
            return setTimeout(bootstrap, 200);
        }
        if (window.appready) {
            startPlugin();
        } else if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') startPlugin();
            });
            // Страховка: если событие уже прошло до нашей подписки — попробуем через секунду
            setTimeout(function () { if (window.appready) startPlugin(); }, 1000);
        } else {
            // Нет Listener — запускаем в лоб
            startPlugin();
        }
    }

    bootstrap();
})();
