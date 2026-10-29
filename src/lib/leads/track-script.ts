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
      var click = params.get(CLICKS[j]);
      if (click) touch.click_ids[CLICKS[j]] = click;
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

  function key() {
    var script = document.currentScript ||
      (function () {
        var all = document.getElementsByTagName('script');
        return all[all.length - 1];
      })();
    return script ? script.getAttribute('data-key') : null;
  }

  function referrer() {
    var ref = document.referrer;
    return ref && ref.indexOf(location.origin) !== 0 ? ref : null;
  }

  var captureKey = key();
  if (!captureKey) return;

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

  function send(action, channel, phone) {
    try {
      fetch('/api/leads/capture', {
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
        if (!body || !body.leadToken) return;
        var token = body.leadToken;
        var links = document.querySelectorAll(
          'a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href^="wa:"], ' +
          'a[href*="instagram.com"], a[href*="tiktok.com"]'
        );
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          if (href.indexOf('ref%20') !== -1 || href.indexOf('ref ') !== -1) continue;
          links[i].setAttribute(
            'data-lead-ref',
            href + (href.indexOf('?') === -1 ? '?' : '&') + 'ref=' + token
          );
        }
      }).catch(function () {});
    } catch (err) {}
  }

  function channelOf(href) {
    if (href.indexOf('instagram.com') !== -1) return 'instagram_dm';
    if (href.indexOf('tiktok.com') !== -1) return 'tiktok_dm';
    return 'whatsapp';
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
    var isSocial =
      href.indexOf('wa.me') !== -1 ||
      href.indexOf('api.whatsapp.com') !== -1 ||
      href.indexOf('wa:') === 0 ||
      href.indexOf('instagram.com') !== -1 ||
      href.indexOf('tiktok.com') !== -1;
    if (!isSocial) return;
    send('link_click', channelOf(href), phoneOf());
  }, true);
})();
`;
