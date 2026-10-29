/**
 * The script the client pastes on their own site.
 *
 * Plain JS, no dependency, ~1 KB. It reads the UTM parameters from
 * the URL, remembers the FIRST touch in a first-party cookie, and
 * reports the touch to the CRM when the form is submitted or when a
 * WhatsApp/Instagram/TikTok link is clicked.
 *
 * It creates no contact and sends nothing but the origin. It
 * injects nothing into the DOM.
 *
 * TWO THINGS THIS SCRIPT GETS RIGHT THAT ARE EASY TO GET WRONG:
 *
 * 1. The script runs on the CLIENT's site, so a relative URL would
 *    point at the client, not at the CRM. The endpoint is the place
 *    the script was served from.
 * 2. The code that ties the click to the first message rides INSIDE
 *    the prefilled message (`ref A7X9K2M4`), because that is what
 *    the CRM reads when the message arrives. A URL parameter would
 *    never make it there.
 */
export const TRACK_SCRIPT = `(function () {
  'use strict';
  var COOKIE = 'crmbr_oid';
  var DAYS = 30;
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CLICKS = ['gclid', 'fbclid', 'ttclid', 'wbraid', 'igshid'];

  function readCookie() {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].trim();
      if (pair.indexOf(COOKIE + '=') === 0) {
        return decodeURIComponent(pair.slice(COOKIE.length + 1));
      }
    }
    return null;
  }

  function writeCookie(value) {
    var expires = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = COOKIE + '=' + encodeURIComponent(value) +
      '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  function touchFromUrl(url) {
    var params = new URLSearchParams(url.search);
    var touch = {};
    for (var i = 0; i < UTM.length; i++) {
      var value = params.get(UTM[i]);
      if (value) touch[UTM[i]] = value;
    }
    for (var j = 0; j < CLICKS.length; j++) {
      var click = params.get(CLICKS[j]);
      if (click) touch[CLICKS[j]] = click;
    }
    touch.landing_path = url.pathname;
    return touch;
  }

  function decodeTouch(value) {
    var params = new URLSearchParams(value);
    var touch = { click_ids: {} };
    for (var i = 0; i < UTM.length; i++) {
      var read = params.get(UTM[i]);
      if (read) touch[UTM[i]] = read;
    }
    for (var j = 0; j < CLICKS.length; j++) {
      var read = params.get(CLICKS[j]);
      if (read) touch.click_ids[CLICKS[j]] = read;
    }
    touch.landing_path = params.get('landing_path');
    touch.referrer = params.get('referrer');
    touch.link_code = params.get('link_code');
    touch.lead_token = params.get('lead_token');
    touch.touched_at = params.get('touched_at');
    return touch;
  }

  function encodeTouch(touch) {
    var params = new URLSearchParams();
    for (var i = 0; i < UTM.length; i++) {
      if (touch[UTM[i]]) params.set(UTM[i], touch[UTM[i]]);
    }
    for (var j = 0; j < CLICKS.length; j++) {
      if (touch.click_ids && touch.click_ids[CLICKS[j]]) {
        params.set(CLICKS[j], touch.click_ids[CLICKS[j]]);
      }
    }
    if (touch.landing_path) params.set('landing_path', touch.landing_path);
    if (touch.referrer) params.set('referrer', touch.referrer);
    if (touch.link_code) params.set('link_code', touch.link_code);
    if (touch.lead_token) params.set('lead_token', touch.lead_token);
    if (touch.touched_at) params.set('touched_at', touch.touched_at);
    return params.toString();
  }

  function scriptElement() {
    return document.currentScript ||
      (function () {
        var all = document.getElementsByTagName('script');
        return all[all.length - 1];
      })();
  }

  function key() {
    var script = scriptElement();
    return script ? script.getAttribute('data-key') : null;
  }

  // Where the API lives. The script runs on the CLIENT's site, so a
  // relative URL would point at the client — the endpoint is where
  // the script itself was served from.
  function apiBase() {
    var script = scriptElement();
    var src = script ? script.getAttribute('src') : null;
    if (!src) return null;
    var base = src.split('?')[0].split('#')[0].replace(/\\/api\\/leads\\/track\\.js$/, '');
    if (base.indexOf('http') !== 0 && base.indexOf('//') !== 0) return null;
    return base;
  }

  function referrer() {
    var ref = document.referrer;
    return ref && ref.indexOf(location.origin) !== 0 ? ref : null;
  }

  var captureKey = key();
  var endpoint = apiBase();
  if (!captureKey || !endpoint) return;
  var CAPTURE_URL = endpoint + '/api/leads/capture';

  var now = touchFromUrl(location);
  now.referrer = referrer();
  now.touched_at = new Date().toISOString();

  // WRITE ONCE. The first touch is the origin — a later visit must
  // not overwrite it.
  var stored = readCookie();
  if (!stored) {
    stored = encodeTouch(now);
    writeCookie(stored);
  }
  var first = decodeTouch(stored);

  // The code goes INSIDE the prefilled message: the CRM reads it
  // from the text the customer sends. It is "ref A7X9K2M4" — a
  // space, not an equals sign.
  function withToken(href, token) {
    var code = encodeURIComponent('ref ' + token);
    var hashIndex = href.indexOf('#');
    var hash = hashIndex === -1 ? '' : href.slice(hashIndex);
    var base = hashIndex === -1 ? href : href.slice(0, hashIndex);
    var queryIndex = base.indexOf('?');
    var path = queryIndex === -1 ? base : base.slice(0, queryIndex);
    var query = queryIndex === -1 ? '' : base.slice(queryIndex + 1);

    // A "wa:" link carries the message as "?text=".
    if (path.indexOf('wa:') === 0) {
      return path + '?text=' + code + hash;
    }

    // wa.me and api.whatsapp.com: append the code to the message
    // that is already there.
    var parts = query ? query.split('&') : [];
    var found = false;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('text=') === 0) {
        parts[i] = parts[i] + '%20' + code;
        found = true;
      }
    }
    if (!found) parts.push('text=' + code);
    return path + '?' + parts.join('&') + hash;
  }

  // The token, or null when the capture did not answer.
  function send(action, channel, phone) {
    try {
      return fetch(CAPTURE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-capture-key': captureKey
        },
        credentials: 'omit',
        keepalive: true,
        body: JSON.stringify({
          action: action,
          channel: channel,
          phone: phone || null,
          first: first,
          now: now
        })
      }).then(function (res) {
        return res.ok ? res.json() : null;
      }).then(function (body) {
        return body && body.leadToken ? body.leadToken : null;
      }).catch(function () {
        return null;
      });
    } catch (err) {
      return Promise.resolve(null);
    }
  }

  function channelOf(href) {
    if (href.indexOf('instagram.com') !== -1) return 'instagram_dm';
    if (href.indexOf('tiktok.com') !== -1) return 'tiktok_dm';
    return 'whatsapp';
  }

  function isWhatsapp(href) {
    return href.indexOf('wa.me') !== -1 ||
      href.indexOf('api.whatsapp.com') !== -1 ||
      href.indexOf('wa:') === 0;
  }

  function phoneOf() {
    var field = document.querySelector(
      'input[name="phone"], input[name="telefone"], input[name="whatsapp"], ' +
      'input[type="tel"]'
    );
    return field && field.value ? field.value : null;
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.tagName || form.tagName.toLowerCase() !== 'form') return;
    send('form_submit', 'web', phoneOf());
  }, true);

  document.addEventListener(
    'blur',
    function (event) {
      var target = event.target;
      if (!target || !target.name) return;
      var name = String(target.name).toLowerCase();
      if (name !== 'phone' && name !== 'telefone' && name !== 'whatsapp') return;
      send('link_click', 'web', target.value);
    },
    true
  );

  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node.tagName && node.tagName.toLowerCase() !== 'a') {
      node = node.parentNode;
    }
    if (!node || !node.getAttribute) return;
    var href = node.getAttribute('href') || '';
    var social =
      href.indexOf('wa.me') !== -1 ||
      href.indexOf('api.whatsapp.com') !== -1 ||
      href.indexOf('wa:') === 0 ||
      href.indexOf('instagram.com') !== -1 ||
      href.indexOf('tiktok.com') !== -1;
    if (!social) return;

    // Instagram and TikTok have no prefilled message: the code
    // cannot ride along. There, the ad's own referral does the job.
    if (!isWhatsapp(href)) {
      send('link_click', channelOf(href), phoneOf());
      return;
    }

    // The code has to be IN the message the customer sends, and the
    // message only exists once the capture answers. So the click
    // waits for the code and then goes.
    event.preventDefault();
    var blank = node.getAttribute('target') === '_blank';
    send('link_click', 'whatsapp', phoneOf()).then(function (token) {
      var url = token ? withToken(href, token) : href;
      if (blank) {
        var opened = window.open(url, '_blank');
        if (opened) opened.opener = null;
        else window.location.href = url;
      } else {
        window.location.href = url;
      }
    });
  }, true);
})();
`
