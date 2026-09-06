
/* ============================================================
   CoedmTan · 第三方编程猫社区 SPA
   ============================================================ */
'use strict';

/* ---------- tiny helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || '').trim();
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}



function mdToHtml(src) {
  const esc = escapeHtml(src || '');
  const lines = esc.split(/\r?\n/);
  let html = '';
  let listOpen = false;
  const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  lines.forEach((line) => {
    const t = line.trim();
    const m = t.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      closeList();
      const lv = m[1].length;
      html += `<h${lv}>${inline(m[2])}</h${lv}>`;
      return;
    }
    if (t === '```') {
      if (html.includes('<pre><code>') && !html.endsWith('</code></pre>')) {
        html += '</code></pre>';
      } else {
        closeList();
        html += '<pre><code>';
      }
      return;
    }
    if (html.includes('<pre><code>') && !html.endsWith('</code></pre>')) {
      html += line + '\n';
      return;
    }
    if (/^(\s*[-*])\s+/.test(t)) {
      if (!listOpen) { html += '<ul>'; listOpen = true; }
      html += `<li>${inline(t.replace(/^\s*[-*]\s+/, ''))}</li>`;
      return;
    }
    if (/^\s*\d+\.\s+/.test(t)) {
      if (!listOpen) { html += '<ul>'; listOpen = true; }
      html += `<li>${inline(t.replace(/^\s*\d+\.\s+/, ''))}</li>`;
      return;
    }
    if (/^>\s?/.test(t)) {
      closeList();
      html += `<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`;
      return;
    }
    if (t === '---' || t === '***') {
      closeList();
      html += '<hr>';
      return;
    }
    closeList();
    if (t !== '') html += `<p>${inline(t)}</p>`;
  });
  closeList();
  if (html.includes('<pre><code>') && !html.includes('</code></pre>')) html += '</code></pre>';
  return html;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toast(message, isError = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.style.background = isError ? 'var(--danger)' : '';
  el.classList.add('show');
  clearTimeout(el.__timer);
  el.__timer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    /* ignore */
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.error_message || `请求失败 (${res.status})`);
  }
  return data;
}

/* ---------- app state ---------- */
const state = {
  user: null,
  boards: [],
  boardId: localStorage.getItem('cm3.board') || 'all',
  searchQuery: '',
  posts: [],
  postsTotal: 0,
  postsOffset: 0,
  currentPage: 1,
  loadingMore: false,
  currentPostId: null,
  postDetail: null,
  replies: [],
  repliesTotal: 0,
  repliesOffset: 0,
  commentsCache: {},
  redirect: '/',
};

const DEFAULT_SETTINGS = {
  postMode: 'loadmore',   // loadmore | pagination
  autoLoad: false,        // 滚动到底部自动加载
  bgImage: '',            // 背景图 dataURL
  bgBlur: 0,              // 背景模糊度
  themeColor: '#6b8bff',  // 主题色
  navStyle: 'sticky',     // sticky | floating
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('cm3.settings') || '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem('cm3.settings', JSON.stringify(settings));
  } catch (e) {
    toast('设置保存失败，背景图片可能过大', true);
  }
  applySettings();
}

function applySettings() {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--primary', settings.themeColor);
  rootStyle.setProperty('--primary-2', settings.themeColor);
  rootStyle.setProperty('--primary-soft', `color-mix(in srgb, ${settings.themeColor} 16%, transparent)`);

  document.body.classList.toggle('nav-floating', settings.navStyle === 'floating');

  const bg = $('#bgLayer');
  if (bg) {
    if (settings.bgImage) {
      document.body.classList.add('has-bg');
      bg.style.backgroundImage = `url("${settings.bgImage}")`;
      bg.style.filter = `blur(${Number(settings.bgBlur) || 0}px)`;
      bg.style.display = 'block';
    } else {
      document.body.classList.remove('has-bg');
      bg.style.backgroundImage = 'none';
      bg.style.display = 'none';
    }
  }
}

function normalizePath() {
  let p = decodeURIComponent(location.pathname || '/');
  if (p.endsWith('/index.php')) p = p.slice(0, -10) || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/* ---------- navigation ---------- */
function go(path, push = true) {
  if (push) history.pushState({}, '', path);
  renderApp();
}

window.addEventListener('popstate', () => renderApp());

/* ---------- app shell ---------- */
function headerHTML() {
  const userArea = state.user
    ? `<div class="user-chip">
         <img src="${escapeHtml(state.user.avatar_url || state.user.avatar || '')}" alt="" onerror="this.src='/img/icon.png'">
         <span title="${escapeHtml(state.user.nickname || '')}">${escapeHtml(state.user.nickname || '用户')}</span>
       </div>
       <button class="btn btn-ghost" onclick="logout()">退出</button>`
    : '';

  return `<header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/" onclick="event.preventDefault();go('/')">
        <img class="logo" src="/img/icon.png" alt="CoedmTan">
        <span>CoedmTan<small>第三方编程猫社区</small></span>
      </a>
      <div class="topbar-right">
        ${userArea}
      </div>
    </div>
  </header>`;
}

function bindHeader() {}

/* ---------- settings ---------- */
let settingsPanel = 'general';

function openSettings() {
  let overlay = $('#settingsOverlay');
  if (!overlay) {
    const gearIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const paintIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s-.5-2 1-2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="10.5" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/><circle cx="16" cy="10.5" r="1.1"/></svg>`;
    const infoIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><circle cx="12" cy="7.5" r="1"/></svg>`;
    const genActive = settingsPanel === 'general' ? ' active' : '';
    const appActive = settingsPanel === 'appearance' ? ' active' : '';
    const genCurrent = settingsPanel === 'general' ? ' aria-current="page"' : '';
    const appCurrent = settingsPanel === 'appearance' ? ' aria-current="page"' : '';
    const aboutActive = settingsPanel === 'about' ? ' active' : '';
    const aboutCurrent = settingsPanel === 'about' ? ' aria-current="page"' : '';
    const html = `<div class="settings-overlay hidden" id="settingsOverlay">
      <div class="settings-stage">
        <nav class="nav-rail" aria-label="设置导航">
          <ul class="nav-list">
            <li>
              <button type="button" class="nav-item${genActive}" data-panel="general"${genCurrent}>
                <span class="icon-wrap">${gearIcon}</span>
                <span class="label">通用</span>
              </button>
            </li>
            <li>
              <button type="button" class="nav-item${appActive}" data-panel="appearance"${appCurrent}>
                <span class="icon-wrap">${paintIcon}</span>
                <span class="label">外观</span>
              </button>
            </li>
            <li>
              <button type="button" class="nav-item${aboutActive}" data-panel="about"${aboutCurrent}>
                <span class="icon-wrap">${infoIcon}</span>
                <span class="label">关于</span>
              </button>
            </li>
          </ul>
        </nav>
        <div class="settings-modal">
          <div class="settings-content">
            <header class="settings-header">
              <nav class="settings-breadcrumb" aria-label="设置位置">
                <span>设置</span>
                <span class="crumb-arrow">›</span>
                <strong id="settingsCrumb">通用</strong>
              </nav>
              <div class="settings-search">
                <span class="settings-search-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
                </span>
                <input type="search" placeholder="搜索设置" aria-label="搜索设置">
              </div>
              <button class="settings-close" id="settingsClose" type="button">&times;</button>
            </header>
            <div class="settings-panel" id="settingsPanel"></div>
          </div>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }
  overlay.classList.remove('hidden');
  renderSettings();
}

function closeSettings() {
  const overlay = $('#settingsOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function renderSettings() {
  const overlay = $('#settingsOverlay');
  if (!overlay) return;
  const crumb = $('#settingsCrumb');
  if (crumb) crumb.textContent = settingsPanel === 'general' ? '通用' : (settingsPanel === 'appearance' ? '外观' : '关于');
  $$('.nav-item[data-panel]', overlay).forEach((btn) => {
    const active = btn.dataset.panel === settingsPanel;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  const panel = $('#settingsPanel');
  if (!panel) return;
  const inner = settingsPanel === 'general' ? settingsGeneralHTML() : (settingsPanel === 'appearance' ? settingsAppearanceHTML() : settingsAboutHTML());
  const metaIcons = {
    general: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    appearance: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s-.5-2 1-2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="10.5" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/><circle cx="16" cy="10.5" r="1.1"/></svg>',
    about: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><circle cx="12" cy="7.5" r="1"/></svg>',
  };
  const meta = {
    general: { title: '通用', desc: '配置帖子刷新、自动加载等交互行为。', icon: metaIcons.general },
    appearance: { title: '外观', desc: '配置页面背景、模糊度与网站主题色。', icon: metaIcons.appearance },
    about: { title: '关于', desc: '项目介绍、开源地址与友情链接。', icon: metaIcons.about },
  }[settingsPanel] || { title: '设置', desc: '', icon: '' };
  panel.innerHTML = `
    <header class="settings-section-heading" data-settings-title="${escapeHtml(meta.title)}">
      <span class="section-icon-dot">${meta.icon}</span>
      <span class="settings-section-heading__content">
        <h2>${escapeHtml(meta.title)}</h2>
        <p>${escapeHtml(meta.desc)}</p>
      </span>
    </header>
    ${inner}`;
  bindSettingsEvents();
  if (settingsPanel === 'appearance') loadPresetBackgrounds();
}

function settingsAboutHTML() {
  return `
    <div class="setting-group">
      <h4>关于 CoedmTan</h4>
      <div class="setting-card">
        <p class="card-desc" style="margin-bottom:8px">CoedmTan 是一个第三方编程猫社区论坛前端，采用简洁的深色界面，支持浏览帖子、发帖、回帖、评论、回复、搜索、深色/毛玻璃外观设置等功能。项目通过编程猫社区开放 API 与官方数据交互，所有敏感请求由 PHP 后端代理处理。</p>
        <p class="card-desc" style="margin-bottom:0">如果喜欢这个项目，欢迎到 GitHub 点个Star✨ ，查看源码、提出建议或参与维护。</p>
      </div>
    </div>
    <div class="setting-group">
      <h4>开源地址</h4>
      <div class="setting-card">
        <a href="https://github.com/Creat319/codem-tan" target="_blank" rel="noopener noreferrer" style="word-break:break-all">https://github.com/Creat319/codem-tan</a>
      </div>
    </div>
    <div class="setting-group">
      <h4>友情链接</h4>
      <div class="setting-card">
        <a href="https://archive.fumizuki.space" target="_blank" rel="noopener noreferrer">CodeMao 社区论坛帖子归档</a>
        <div class="muted" style="margin-top:6px;font-size:12.5px">archive.fumizuki.space</div>
      </div>
    </div>`;
}

function settingsGeneralHTML() {
  const loadChecked = settings.postMode !== 'pagination' ? 'checked' : '';
  const pageChecked = settings.postMode === 'pagination' ? 'checked' : '';
  const autoChecked = settings.autoLoad ? 'checked' : '';
  const autoHidden = settings.postMode === 'pagination' ? ' hidden' : '';
  return `
    <div class="setting-group">
      <h4>帖子刷新模式</h4>
      <div class="setting-card">
        <div class="radio-row">
          <label class="radio-option">
            <input type="radio" name="postMode" value="loadmore" ${loadChecked}>
            <span>
              <span class="opt-title">点击加载更多</span>
              <span class="opt-desc">帖子底部显示“加载更多”按钮，点击后追加帖子</span>
            </span>
          </label>
          <label class="radio-option">
            <input type="radio" name="postMode" value="pagination" ${pageChecked}>
            <span>
              <span class="opt-title">翻页模式</span>
              <span class="opt-desc">使用 1、2、3、4、5 这样的分页切换帖子</span>
            </span>
          </label>
        </div>
      </div>
      <div class="setting-card${autoHidden}" id="autoLoadWrap">
        <div class="switch-line">
          <span class="switch-text">滚动到底部自动加载下一页</span>
          <label class="switch">
            <input type="checkbox" id="autoLoad" ${autoChecked}>
            <span class="slider"></span>
          </label>
        </div>
        <div class="muted" style="font-size:12.5px;margin-top:6px">仅“点击加载更多”模式下可用</div>
      </div>
    </div>`;
}

function settingsAppearanceHTML() {
  const bgStatus = settings.bgImage ? '已设置背景图片' : '未设置背景图片';
  const presets = ['#6b8bff', '#ff6b8b', '#06d6a0', '#ffb347', '#b07cff', '#3ddc97'];
  const presetHtml = presets.map((c) =>
    `<button type="button" data-color="${c}" style="background:${c}" class="${settings.themeColor.toLowerCase() === c.toLowerCase() ? 'active' : ''}" title="${c}"></button>`
  ).join('');
  return `
    <div class="setting-group">
      <h4>页面背景</h4>
      <div class="setting-card">
        <div class="preset-title">自定义上传背景</div>
        <div class="bg-upload-row">
          <label class="file-btn">选择背景图片<input type="file" id="bgFile" accept="image/*"></label>
          <button class="clear-btn" id="clearBg" type="button">清除背景</button>
          <span class="muted" id="bgStatus">${bgStatus}</span>
        </div>
        <div class="range-row" style="margin-top:18px">
          <span style="white-space:nowrap">图片模糊度</span>
          <input type="range" id="bgBlur" min="0" max="24" step="1" value="${Number(settings.bgBlur) || 0}">
          <span class="muted" id="bgBlurValue" style="width:52px;text-align:right">${Number(settings.bgBlur) || 0}px</span>
        </div>
      </div>
      <div class="setting-card">
        <div class="preset-title">预设背景</div>
        <div class="preset-grid" id="presetGrid"><span class="muted">加载中…</span></div>
      </div>
    </div>
    <div class="setting-group">
      <h4>网站导航栏</h4>
      <div class="setting-card">
        <div class="radio-row">
          <label class="radio-option">
            <input type="radio" name="navStyle" value="sticky" ${settings.navStyle === 'floating' ? '' : 'checked'}>
            <span>
              <span class="opt-title">固定在顶部</span>
              <span class="opt-desc">导航栏贴住页面顶部，随页面滚动保持置顶</span>
            </span>
          </label>
          <label class="radio-option">
            <input type="radio" name="navStyle" value="floating" ${settings.navStyle === 'floating' ? 'checked' : ''}>
            <span>
              <span class="opt-title">悬浮式导航栏</span>
              <span class="opt-desc">横向长方形导航栏悬浮在页面顶部，带圆角和间距</span>
            </span>
          </label>
        </div>
      </div>
    </div>
    <div class="setting-group">
      <h4>网站主题色</h4>
      <div class="setting-card">
        <div class="color-row">
          <input type="color" id="themeColor" value="${escapeHtml(settings.themeColor)}">
          <div class="color-presets">${presetHtml}</div>
        </div>
      </div>
    </div>`;
}

async function loadPresetBackgrounds() {
  const grid = $('#presetGrid');
  if (!grid) return;
  try {
    const data = await api('/api/backgrounds');
    const urls = data.items || [];
    if (!urls.length) {
      grid.innerHTML = '<span class="muted">暂无可用的预设背景</span>';
      return;
    }
    grid.innerHTML = urls.map((url) => {
      const active = settings.bgImage === url ? ' active' : '';
      return `<button type="button" class="preset-item${active}" data-url="${escapeHtml(url)}" style="background-image:url('${escapeHtml(url)}')"></button>`;
    }).join('');
    $$('.preset-item', grid).forEach((btn) => {
      btn.onclick = () => {
        settings.bgImage = btn.dataset.url;
        saveSettings();
        renderSettings();
      };
    });
  } catch (e) {
    grid.innerHTML = '<span class="muted">预设背景加载失败</span>';
  }
}

function bindSettingsEvents() {
  const overlay = $('#settingsOverlay');
  if (!overlay) return;

  $$('.nav-item[data-panel]', overlay).forEach((btn) => {
    btn.onclick = () => {
      settingsPanel = btn.dataset.panel;
      renderSettings();
    };
  });

  const closeBtn = $('#settingsClose', overlay);
  if (closeBtn) closeBtn.onclick = closeSettings;
  overlay.onclick = (e) => {
    if (e.target === overlay) closeSettings();
  };

  $$('input[name="postMode"]', overlay).forEach((radio) => {
    radio.onchange = () => {
      if (radio.checked) settings.postMode = radio.value;
      saveSettings();
      renderSettings();
      refreshHomeFooter();
    };
  });

  $$('input[name="navStyle"]', overlay).forEach((radio) => {
    radio.onchange = () => {
      if (radio.checked) settings.navStyle = radio.value;
      saveSettings();
    };
  });

  const autoLoad = $('#autoLoad', overlay);
  if (autoLoad) {
    autoLoad.onchange = () => {
      settings.autoLoad = autoLoad.checked;
      saveSettings();
    };
  }

  const bgFile = $('#bgFile', overlay);
  if (bgFile) {
    bgFile.onchange = () => {
      const file = bgFile.files && bgFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        settings.bgImage = reader.result;
        saveSettings();
        const status = $('#bgStatus');
        if (status) status.textContent = '已设置背景图片';
        renderSettings();
      };
      reader.readAsDataURL(file);
    };
  }

  const clearBg = $('#clearBg', overlay);
  if (clearBg) {
    clearBg.onclick = () => {
      settings.bgImage = '';
      saveSettings();
      renderSettings();
    };
  }

  const bgBlur = $('#bgBlur', overlay);
  if (bgBlur) {
    bgBlur.oninput = () => {
      settings.bgBlur = Number(bgBlur.value) || 0;
      const val = $('#bgBlurValue');
      if (val) val.textContent = `${settings.bgBlur}px`;
      applySettings();
      saveSettings();
    };
  }

  const themeColor = $('#themeColor', overlay);
  if (themeColor) {
    themeColor.oninput = () => {
      settings.themeColor = themeColor.value;
      applySettings();
      const activeBtn = $('.color-presets .active', overlay);
      if (activeBtn) activeBtn.classList.remove('active');
    };
    themeColor.onchange = () => {
      saveSettings();
      renderSettings();
    };
  }

  $$('.color-presets button', overlay).forEach((btn) => {
    btn.onclick = () => {
      settings.themeColor = btn.dataset.color;
      saveSettings();
      renderSettings();
      refreshHomeFooter();
    };
  });
}

function refreshHomeFooter() {
  if ($('#postsArea')) renderPostList();
}

window.openSettings = openSettings;
window.closeSettings = closeSettings;

/* ---------- composer: publish post ---------- */
let composerFormat = 'markdown';
let composerBoardId = '';
let composerPreviewOpen = false;

async function openComposer() {
  if (!state.user) {
    toast('请先登录', true);
    return;
  }
  if (!state.boards.length) {
    try {
      const data = await api('/api/boards');
      const real = (data.items || []).filter((b) => b && b.name);
      state.boards = [{ id: 'all', name: '全部', icon_url: '', is_all: true }, ...real];
    } catch (e) {
      toast(e.message, true);
      return;
    }
  }
  let overlay = $('#composerOverlay');
  if (!overlay) {
    const html = `<div class="composer-overlay hidden" id="composerOverlay">
      <div class="composer-modal">
        <header class="composer-header">
          <h3>发布帖子</h3>
          <button class="settings-close" id="composerClose" type="button">&times;</button>
        </header>
        <div class="composer-body">
          <div class="field">
            <label>选择板块</label>
            <div class="board-picker" id="composerBoardWrap">
              <button type="button" class="board-picker-current" id="composerBoardCurrent">
                <span class="board-picker-icon" id="composerBoardCurrentIcon"></span>
                <span id="composerBoardCurrentName">选择板块</span>
                <span class="board-picker-arrow">›</span>
              </button>
              <div class="board-picker-list" id="composerBoardList"></div>
            </div>
          </div>
          <div class="field">
            <label for="composerTitle">标题</label>
            <input id="composerTitle" maxlength="80" placeholder="请输入帖子标题">
          </div>
          <div class="field">
            <div class="editor-toolbar">
              <div class="editor-tabs">
                <button type="button" class="editor-tab active" data-format="markdown">Markdown</button>
                <button type="button" class="editor-tab" data-format="html">HTML</button>
              </div>
              <button type="button" class="preview-toggle" id="composerPreviewToggle">预览</button>
            </div>
            <div class="md-editor">
              <textarea id="composerContent" rows="9" placeholder="支持 Markdown，也可以切换到 HTML 直接编写"></textarea>
              <div class="md-preview hidden" id="composerPreview"></div>
            </div>
          </div>
          <div class="composer-error hidden" id="composerError"></div>
        </div>
        <footer class="composer-footer">
          <button class="btn btn-ghost" id="composerCancel" type="button">取消</button>
          <button class="btn btn-primary" id="composerSubmit" type="button">发布</button>
        </footer>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }
  composerFormat = 'markdown';
  composerPreviewOpen = false;
  const boards = state.boards.filter((b) => String(b.id) !== 'all');
  composerBoardId = boards.some((b) => String(b.id) === String(state.boardId))
    ? state.boardId
    : (boards[0] ? boards[0].id : '');
  renderComposerBoardPicker(boards);
  updateComposerBoardCurrent(boards);

  const title = $('#composerTitle');
  const content = $('#composerContent');
  const preview = $('#composerPreview');
  if (title) title.value = '';
  if (content) content.value = '';
  if (preview) {
    preview.classList.add('hidden');
    preview.innerHTML = '';
  }
  $$('.editor-tab', overlay).forEach((tab) => tab.classList.toggle('active', tab.dataset.format === 'markdown'));
  const previewToggle = $('#composerPreviewToggle');
  if (previewToggle) previewToggle.textContent = '预览';
  const err = $('#composerError');
  if (err) err.classList.add('hidden');
  overlay.classList.remove('hidden');
  bindComposerEvents();
}

function renderComposerBoardPicker(boards) {
  const list = $('#composerBoardList');
  if (!list) return;
  list.innerHTML = boards.map((b) => `
    <button type="button" class="board-option" data-board="${escapeHtml(b.id)}">
      ${boardIconHTML(b)}
      <span>${escapeHtml(b.name)}</span>
    </button>
  `).join('');
}

function updateComposerBoardCurrent(boards) {
  const board = boards.find((b) => String(b.id) === String(composerBoardId)) || boards[0];
  if (!board) return;
  composerBoardId = board.id;
  const icon = $('#composerBoardCurrentIcon');
  const name = $('#composerBoardCurrentName');
  if (icon) icon.innerHTML = boardIconHTML(board);
  if (name) name.textContent = board.name;
}

function updateComposerPreview() {
  const textarea = $('#composerContent');
  const preview = $('#composerPreview');
  if (!textarea || !preview) return;
  if (!composerPreviewOpen) return;
  const raw = textarea.value || '';
  preview.innerHTML = composerFormat === 'markdown' ? mdToHtml(raw) : raw;
}

function closeComposer() {
  const overlay = $('#composerOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
    const wrap = $('#composerBoardWrap');
    if (wrap) wrap.classList.remove('open');
  }
}

function bindComposerEvents() {
  const overlay = $('#composerOverlay');
  if (!overlay) return;
  const closeBtn = $('#composerClose', overlay);
  if (closeBtn) closeBtn.onclick = closeComposer;
  const cancelBtn = $('#composerCancel', overlay);
  if (cancelBtn) cancelBtn.onclick = closeComposer;
  overlay.onclick = (e) => { if (e.target === overlay) closeComposer(); };

  // board picker
  const boardWrap = $('#composerBoardWrap', overlay);
  const boardCurrent = $('#composerBoardCurrent', overlay);
  if (boardWrap && boardCurrent) {
    boardCurrent.onclick = (e) => {
      e.stopPropagation();
      boardWrap.classList.toggle('open');
    };
  }
  const boardList = $('#composerBoardList', overlay);
  if (boardList) {
    $$('.board-option', boardList).forEach((opt) => {
      opt.onclick = () => {
        composerBoardId = opt.dataset.board;
        updateComposerBoardCurrent(state.boards.filter((b) => String(b.id) !== 'all'));
        boardWrap.classList.remove('open');
      };
    });
  }
  if (!window.__composerDocBound) {
    document.addEventListener('click', () => {
      const wrap = $('#composerBoardWrap');
      if (wrap) wrap.classList.remove('open');
    });
    window.__composerDocBound = true;
  }

  // format tabs / preview
  $$('.editor-tab', overlay).forEach((tab) => {
    tab.onclick = () => {
      composerFormat = tab.dataset.format;
      $$('.editor-tab', overlay).forEach((t) => t.classList.toggle('active', t === tab));
      updateComposerPreview();
    };
  });
  const previewToggle = $('#composerPreviewToggle', overlay);
  if (previewToggle) {
    previewToggle.onclick = () => {
      composerPreviewOpen = !composerPreviewOpen;
      const preview = $('#composerPreview', overlay);
      if (preview) {
        preview.classList.toggle('hidden', !composerPreviewOpen);
        if (composerPreviewOpen) updateComposerPreview();
      }
      previewToggle.textContent = composerPreviewOpen ? '隐藏预览' : '预览';
    };
  }
  const contentInput = $('#composerContent', overlay);
  if (contentInput) contentInput.addEventListener('input', updateComposerPreview);

  const submit = $('#composerSubmit', overlay);
  if (submit) {
    submit.onclick = async () => {
      const boardId = composerBoardId;
      const raw = ($('#composerContent', overlay).value || '').trim();
      const title = ($('#composerTitle', overlay).value || '').trim();
      const content = composerFormat === 'markdown' ? mdToHtml(raw) : raw;
      const error = $('#composerError', overlay);
      if (error) error.classList.add('hidden');
      if (!boardId || boardId === 'all') {
        if (error) { error.textContent = '请选择要发布的板块'; error.classList.remove('hidden'); }
        return;
      }
      if (!title) {
        if (error) { error.textContent = '标题不能为空'; error.classList.remove('hidden'); }
        return;
      }
      if (!content) {
        if (error) { error.textContent = '内容不能为空'; error.classList.remove('hidden'); }
        return;
      }
      submit.disabled = true;
      submit.textContent = '发布中…';
      try {
        const data = await api('/api/publish', {
          method: 'POST',
          body: { board_id: boardId, title, content },
        });
        closeComposer();
        toast('发布成功');
        const id = data.id;
        if (id) {
          go('/tie/' + encodeURIComponent(id));
        } else {
          state.boardId = boardId;
          localStorage.setItem('cm3.board', boardId);
          if (normalizePath() === '/') loadPosts(true);
        }
      } catch (err) {
        if (error) {
          error.textContent = err.message || '发布失败';
          error.classList.remove('hidden');
        } else {
          toast(err.message, true);
        }
      } finally {
        submit.disabled = false;
        submit.textContent = '发布';
      }
    };
  }
}

window.openComposer = openComposer;
window.closeComposer = closeComposer;

/* ---------- delete: post / reply / comment ---------- */
async function deletePost(postId) {
  if (!confirm('确定删除这篇帖子吗？删除后无法恢复。')) return;
  try {
    await api('/api/delete_post', { method: 'POST', body: { post_id: postId } });
    toast('帖子已删除');
    go('/');
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteReply(replyId) {
  if (!confirm('确定删除这条回帖吗？删除后无法恢复。')) return;
  try {
    await api('/api/delete_reply', { method: 'POST', body: { reply_id: replyId } });
    toast('回帖已删除');
    await loadReplies(true);
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteComment(replyId, commentId) {
  if (!confirm('确定删除这条评论/回复吗？删除后无法恢复。')) return;
  try {
    await api('/api/delete_comment', { method: 'POST', body: { comment_id: commentId } });
    toast('评论已删除');
    if (state.commentsCache[replyId]) delete state.commentsCache[replyId];
    await loadReplies(true);
  } catch (e) {
    toast(e.message, true);
  }
}

window.deletePost = deletePost;
window.deleteReply = deleteReply;
window.deleteComment = deleteComment;

/* ---------- login ---------- *//* ---------- login ---------- */
function loginHTML() {
  return `<div class="login-wrap">
    <div class="login-card">
      <img class="login-logo" src="/img/icon.png" alt="CoedmTan">
      <h1>CoedmTan</h1>
      <p class="sub">本项目由AI辅助开发，所以问题多是正常的，项目已开源，有需要的自己修😁</p>
      <div class="login-error" id="loginError"></div>
      <form id="loginForm" autocomplete="off">
        <div class="field">
          <label for="identity">手机号 / 用户名 / 邮箱</label>
          <input id="identity" name="identity" placeholder="请输入编程猫账号" required>
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" name="password" type="password" placeholder="请输入密码" required>
        </div>
        <button class="btn btn-primary" id="loginBtn" type="submit">进入社区</button>
      </form>
      <div class="login-hint">本网站为第三方社区，不会保存你的密码。<br>账号数据均来自编程猫开放接口。</div> <br>https://github.com/Creat319/codem-tan</div>
    </div>
  </div>`;
}

function bindLogin() {
  const form = $('#loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const error = $('#loginError');
    error.classList.remove('show');
    const identity = $('#identity').value.trim();
    const password = $('#password').value;
    if (!identity || !password) {
      error.textContent = '请填写账号和密码';
      error.classList.add('show');
      return;
    }
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: { identity, password },
      });
      state.user = data.user || null;
      toast('登录成功，欢迎回来');
      const target = state.redirect && state.redirect !== '/' ? state.redirect : '/';
      state.redirect = '/';
      go(target);
    } catch (err) {
      error.textContent = err.message || '登录失败';
      error.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = '进入社区';
    }
  });
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (e) { /* ignore */ }
  state.user = null;
  state.redirect = '/';
  go('/');
}

/* ---------- home: boards + post list ---------- */
function homeHTML() {
  return `<main class="page">
    <div class="home-layout">
      <div class="home-main">
        <div class="section-head">
          <h2>社区帖子</h2>
          <div class="head-actions">
            <div class="search-box" id="searchBox">
              <span class="search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
              </span>
              <input id="postSearch" class="search-input" type="text" placeholder="搜索帖子标题" autocomplete="off">
            </div>
            <span class="muted" id="postCount"></span>
          </div>
        </div>
        <div id="postsArea"></div>
      </div>
      <aside class="board-side">
        <button class="publish-btn" onclick="openComposer()">发帖</button>
        <div class="side-title">帖子分类</div>
        <div class="board-tabs" id="boardTabs"></div>
      </aside>
    </div>
  </main>`;
}

async function renderHome() {
  const app = $('#app');
  app.insertAdjacentHTML('beforeend', homeHTML());
  const searchInput = $('#postSearch');
  if (searchInput) searchInput.value = state.searchQuery || '';
  bindPostSearch();
  try {
    if (!state.boards.length) {
      const data = await api('/api/boards');
      const realBoards = (data.items || []).filter((b) => b && b.name);
      state.boards = [{ id: 'all', name: '全部', icon_url: '', is_all: true }, ...realBoards];
    }
    if (state.boards.length && !state.boards.some((b) => String(b.id) === String(state.boardId))) {
      state.boardId = state.boards[0].id;
      localStorage.setItem('cm3.board', state.boardId);
    }
    renderBoardTabs();
  } catch (e) {
    renderBoardTabs();
    showHomeError(e.message);
  }
  await loadPosts(true);
}

function bindPostSearch() {
  const input = $('#postSearch');
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = (input.value || '').trim();
    state.searchQuery = q;
    state.postsOffset = 0;
    state.posts = [];
    loadPosts(true);
  });
}

function boardIconHTML(b) {
  if (String(b.id) === 'all') return '<span class="board-all-dot"></span>';
  if (b.icon_url) return `<img src="${escapeHtml(b.icon_url)}" alt="" onerror="this.style.display='none'">`;
  return '<span class="board-no-icon"></span>';
}

function renderBoardTabs() {
  const wrap = $('#boardTabs');
  if (!wrap) return;
  if (!state.boards.length) {
    wrap.innerHTML = '<div class="skeleton" style="height:42px;width:100%"></div>';
    return;
  }
  wrap.innerHTML = state.boards.map((b) => {
    const active = String(b.id) === String(state.boardId) ? ' active' : '';
    return `<button class="board-tab${active}" data-board="${escapeHtml(b.id)}">${boardIconHTML(b)}${escapeHtml(b.name)}</button>`;
  }).join('');
  $$('.board-tab', wrap).forEach((el) => {
    el.addEventListener('click', () => {
      state.boardId = el.dataset.board;
      localStorage.setItem('cm3.board', state.boardId);
      state.searchQuery = '';
      const searchInput = $('#postSearch');
      if (searchInput) searchInput.value = '';
      renderBoardTabs();
      loadPosts(true);
    });
  });
}

function postCardHTML(p) {
  const user = p.user || {};
  const badges = [];
  if (p.is_pinned) badges.push('<span class="badge badge-pinned">置顶</span>');
  if (p.is_hotted) badges.push('<span class="badge badge-hot">热门</span>');
  if (p.is_featured) badges.push('<span class="badge badge-featured">精选</span>');
  if (p.tutorial_flag) badges.push('<span class="badge badge-featured">教程</span>');
  const title = escapeHtml(p.title || '无标题');
  const excerpt = escapeHtml(stripHtml(p.content || '').slice(0, 120));
  const avatar = user.avatar_url || user.avatar || '';
  const avatarImg = avatar
    ? `<img class="post-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '<img class="post-avatar" src="/img/icon.png" alt="">';

  return `<article class="post-card" onclick="go('/tie/${encodeURIComponent(p.id)}')">
    ${avatarImg}
    <div class="post-main">
      <h3 class="post-title">${badges.join(' ')} ${title}</h3>
      <p class="post-excerpt">${excerpt || '…'}</p>
      <div class="post-meta">
        <span>用户：${escapeHtml(user.nickname || '匿名')}</span>
        <span>时间：${fmtTime(p.created_at)}</span>
        <span>回帖：${p.n_replies ?? 0}</span>
        <span>评论：${p.n_comments ?? 0}</span>
        ${p.replied_at ? `<span>最新回复 ${fmtTime(p.replied_at)}</span>` : ''}
      </div>
    </div>
  </article>`;
}

function renderPostList() {
  const area = $('#postsArea');
  if (!area) return;
  const count = $('#postCount');
  if (count) count.textContent = `共 ${state.postsTotal ?? 0} 帖`;

  if (!state.posts.length) {
    area.innerHTML = '<div class="empty">这个板块暂时没有帖子，去别处看看吧～</div>';
    return;
  }

  let footer = '';
  if (settings.postMode === 'pagination') {
    footer = paginationHTML();
  } else if (state.posts.length < state.postsTotal) {
    footer = '<div class="load-more"><button class="btn btn-ghost" id="loadMore">加载更多</button></div>';
  }

  area.innerHTML = `<div class="post-list">${state.posts.map(postCardHTML).join('')}</div>${footer}`;

  if (settings.postMode === 'pagination') {
    $$('.page-btn[data-page]', area).forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener('click', () => goPostPage(Number(btn.dataset.page)));
    });
  } else {
    const btn = $('#loadMore');
    if (btn) btn.addEventListener('click', () => loadPosts(false));
  }
}

function showHomeError(msg) {
  const area = $('#postsArea');
  if (area) area.innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
}

async function loadPosts(reset = true, startOffset = 0) {
  const area = $('#postsArea');
  if (reset) {
    state.postsOffset = startOffset;
    state.currentPage = Math.floor(state.postsOffset / 10) + 1;
    state.posts = [];
    if (area) area.innerHTML = '<div style="padding:60px 0"><div class="spinner"></div></div>';
  } else {
    if (state.loadingMore) return;
    state.loadingMore = true;
    // 加载更多时不要清空整个列表，只让按钮变成加载状态
    const btn = $('#loadMore');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-spinner"></span>加载中…';
    }
  }
  try {
    const endpoint = state.searchQuery
      ? `/api/search?title=${encodeURIComponent(state.searchQuery)}&limit=10&offset=${state.postsOffset}`
      : `/api/posts?board_id=${encodeURIComponent(state.boardId)}&limit=10&offset=${state.postsOffset}`;
    const data = await api(endpoint);
    const items = data.items || [];
    if (reset) {
      state.posts = items;
    } else {
      state.posts = state.posts.concat(items);
    }
    state.postsTotal = data.total ?? state.posts.length;
    state.postsOffset += items.length;
    if (!reset) {
      state.currentPage = Math.floor(state.postsOffset / 10);
    }
    renderPostList();
  } catch (e) {
    if (reset) {
      showHomeError(e.message);
    } else {
      toast(e.message, true);
      const btn = $('#loadMore');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '加载更多';
      }
    }
  } finally {
    state.loadingMore = false;
  }
}

function goPostPage(page) {
  if (page < 1) return;
  loadPosts(true, (page - 1) * 10);
}

function paginationHTML() {
  const limit = 10;
  const totalPages = Math.max(1, Math.ceil((state.postsTotal || 0) / limit));
  const current = Math.min(state.currentPage || 1, totalPages);
  const pages = [];
  const start = Math.max(1, current - 2);
  const end = Math.min(totalPages, current + 2);
  if (start > 1) pages.push({ type: 'page', value: 1 });
  if (start > 2) pages.push({ type: 'gap' });
  for (let i = start; i <= end; i++) pages.push({ type: 'page', value: i });
  if (end < totalPages - 1) pages.push({ type: 'gap' });
  if (end < totalPages) pages.push({ type: 'page', value: totalPages });

  const prevDisabled = current <= 1 ? 'disabled' : '';
  const nextDisabled = current >= totalPages ? 'disabled' : '';
  return `<div class="pagination">
    <button class="page-btn" data-page="${current - 1}" ${prevDisabled}>上一页</button>
    ${pages.map((p) => p.type === 'gap'
      ? '<span class="page-gap">…</span>'
      : `<button class="page-btn${p.value === current ? ' active' : ''}" data-page="${p.value}">${p.value}</button>`
    ).join('')}
    <button class="page-btn" data-page="${current + 1}" ${nextDisabled}>下一页</button>
  </div>`;
}

function handleAutoLoadMore() {
  if (!state.user || settings.postMode !== 'loadmore' || !settings.autoLoad) return;
  if (state.loadingMore) return;
  if (normalizePath() !== '/') return;
  const btn = $('#loadMore');
  if (!btn || btn.disabled) return;
  const rect = btn.getBoundingClientRect();
  if (rect.top <= window.innerHeight + 120) {
    loadPosts(false);
  }
}

window.addEventListener('scroll', () => {
  if (settings.autoLoad) handleAutoLoadMore();
}, { passive: true });

/* ---------- post detail ---------- */
function detailHTML() {
  return `<main class="page" id="detailPage">
    <div class="crumb"><a href="/" onclick="event.preventDefault();go('/')">← 返回帖子列表</a></div>
    <div id="detailArea"></div>
  </main>`;
}

async function renderPost(postId) {
  const app = $('#app');
  app.insertAdjacentHTML('beforeend', detailHTML());
  state.currentPostId = postId;
  state.postDetail = null;
  state.replies = [];
  state.repliesTotal = 0;
  state.repliesOffset = 0;
  state.commentsCache = {};

  const area = $('#detailArea');
  area.innerHTML = '<div style="padding:80px 0"><div class="spinner"></div></div>';
  try {
    const [detail, repliesData] = await Promise.all([
      api(`/api/post?id=${encodeURIComponent(postId)}`),
      api(`/api/replies?post_id=${encodeURIComponent(postId)}&limit=20&offset=0`),
    ]);
    state.postDetail = detail;
    state.replies = repliesData.items || [];
    state.repliesTotal = repliesData.total || 0;
    state.repliesOffset = state.replies.length;
    renderDetail();
  } catch (e) {
    area.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

function renderDetail() {
  const area = $('#detailArea');
  if (!area || !state.postDetail) return;
  const d = state.postDetail;
  const user = d.user || {};
  const isAuthor = state.user && String(user.id) === String(state.user.id);
  const avatar = user.avatar_url || user.avatar || '';
  const avatarImg = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="" onerror="this.style.visibility='hidden'">`
    : '<img src="/img/icon.png" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;background:var(--bg-hover)">';

  const badges = [];
  if (d.is_pinned) badges.push('<span class="badge badge-pinned">置顶</span>');
  if (d.is_featured) badges.push('<span class="badge badge-featured">精选</span>');
  if (d.is_hotted) badges.push('<span class="badge badge-hot">热门</span>');
  if (d.tutorial_flag) badges.push('<span class="badge badge-featured">教程</span>');

  area.innerHTML = `
    <article class="detail-card">
      <h1 class="detail-title">${badges.join(' ')} ${escapeHtml(d.title || '无标题')}</h1>
      <div class="author-line">
        ${avatarImg}
        <div>
          <div class="author-name">${escapeHtml(user.nickname || '匿名')}</div>
          <div class="stat-line">
            <span>发布于 ${fmtTime(d.created_at)}</span>
            <span>浏览：${d.n_views ?? 0}</span>
            <span>回帖：${d.n_replies ?? 0}</span>
            <span>评论：${d.n_comments ?? 0}</span>
          </div>
        </div>
        ${isAuthor ? `<button class="btn btn-danger btn-sm author-delete" onclick="deletePost('${escapeHtml(d.id)}')">删除帖子</button>` : ''}
      </div>
      <div class="rich-content">${d.content || ''}</div>
    </article>

    <div class="section-block">
      <div class="section-title">发表回帖</div>
      <div class="reply-box">
        <textarea id="replyContent" placeholder="友善发言，理性讨论…"></textarea>
        <div class="reply-actions">
          <button class="btn btn-primary" id="submitReply">发布回帖</button>
        </div>
      </div>
    </div>

    <div class="section-block">
      <div class="section-title">全部回帖 <span class="muted" id="replyTotal"></span></div>
      <div id="replyList"></div>
    </div>
  `;

  const submit = $('#submitReply');
  submit.addEventListener('click', () => submitPostReply());

  renderReplyList();
}

async function submitPostReply() {
  const textarea = $('#replyContent');
  const content = textToHtml((textarea.value || '').trim());
  if (!content) {
    toast('回帖内容不能为空', true);
    return;
  }
  const btn = $('#submitReply');
  btn.disabled = true;
  try {
    await api('/api/reply', {
      method: 'POST',
      body: { post_id: state.currentPostId, content },
    });
    textarea.value = '';
    toast('回帖成功');
    await loadReplies(true);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function loadReplies(reset = true) {
  const list = $('#replyList');
  if (!list) return;
  if (reset) {
    state.repliesOffset = 0;
    state.replies = [];
    state.commentsCache = {};
  }
  const totalEl = $('#replyTotal');
  if (totalEl) totalEl.textContent = '';
  list.innerHTML = '<div style="padding:40px 0"><div class="spinner"></div></div>';
  try {
    const data = await api(`/api/replies?post_id=${encodeURIComponent(state.currentPostId)}&limit=20&offset=${state.repliesOffset}`);
    const items = data.items || [];
    if (reset) {
      state.replies = items;
    } else {
      state.replies = state.replies.concat(items);
    }
    state.repliesTotal = data.total ?? state.replies.length;
    state.repliesOffset += items.length;
    if (totalEl) totalEl.textContent = `（${state.repliesTotal}）`;
    renderReplyList();
  } catch (e) {
    list.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
  }
}

function replyItemHTML(reply, index) {
  const user = reply.user || {};
  const isAuthor = state.user && String(user.id) === String(state.user.id);
  const avatar = user.avatar_url || user.avatar || '';
  const avatarImg = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="" onerror="this.style.visibility='hidden'">`
    : '<img src="/img/icon.png" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;background:var(--bg-hover)">';

  return `<div class="reply-item" data-reply="${escapeHtml(reply.id)}">
    <div class="reply-head">
      ${avatarImg}
      <div class="who">
        <b>${escapeHtml(user.nickname || '匿名')}</b>
        <span class="time">${fmtTime(reply.created_at)}${reply.is_top ? ' · 置顶' : ''}</span>
      </div>
      <button class="link-btn" data-action="reply-form" data-reply="${escapeHtml(reply.id)}">回复</button>
      ${isAuthor ? `<button class="link-btn danger-link" onclick="deleteReply('${escapeHtml(reply.id)}')">删除</button>` : ''}
    </div>
    <div class="reply-content">${reply.content || ''}</div>
    <div class="comment-zone" data-comments-for="${escapeHtml(reply.id)}"></div>
  </div>`;
}

function renderReplyList() {
  const list = $('#replyList');
  if (!list) return;
  if (!state.replies.length) {
    list.innerHTML = '<div class="empty">还没有回帖，来抢沙发～</div>';
    return;
  }
  list.innerHTML = state.replies.map((r, i) => replyItemHTML(r, i)).join('');

  // initialise comment zones
  state.replies.forEach((reply) => {
    const zone = $(`[data-comments-for="${CSS.escape(reply.id)}"]`);
    if (zone) renderComments(reply, zone);
  });

  if (state.replies.length < state.repliesTotal) {
    list.insertAdjacentHTML('beforeend', '<div class="load-more"><button class="btn btn-ghost" id="moreReplies">加载更多回帖</button></div>');
    const btn = $('#moreReplies');
    if (btn) btn.addEventListener('click', () => loadReplies(false));
  }
}

function renderComments(reply, zone) {
  if (!zone) return;
  const comments = (reply.earliest_comments || []).slice();
  if (state.commentsCache[reply.id]) {
    zone.dataset.loaded = '1';
    zone.innerHTML = state.commentsCache[reply.id].map((c) => commentHTML(reply.id, c)).join('');
    return;
  }
  zone.innerHTML = comments.map((c) => commentHTML(reply.id, c)).join('');
  const needMore = (reply.n_comments || 0) > comments.length;
  if (needMore) {
    const btn = document.createElement('button');
    btn.className = 'expand-btn';
    btn.dataset.action = 'expand-comments';
    btn.dataset.reply = reply.id;
    btn.textContent = `展开全部 ${reply.n_comments} 条评论`;
    zone.appendChild(btn);
  }
}

function commentHTML(replyId, c) {
  const user = c.user || {};
  const isAuthor = state.user && String(user.id) === String(state.user.id);
  const avatar = user.avatar_url || user.avatar || '';
  const avatarImg = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="" onerror="this.style.visibility='hidden'">`
    : '<img src="/img/icon.png" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover">';
  const replyName = c.reply_user
    ? ` <span class="reply-name">回复 @${escapeHtml(c.reply_user.nickname || '')}</span>`
    : '';
  return `<div class="comment-item">
    <div class="c-head">
      <img src="${escapeHtml(avatar)}" alt="" onerror="this.style.visibility='hidden'"> <b>${escapeHtml(user.nickname || '匿名')}</b>${replyName}
      <span class="time">${fmtTime(c.created_at)}</span>
    </div>
    <div class="c-body">${c.content || ''}</div>
    <div class="comment-actions">
      <button class="link-btn" data-action="comment-form" data-reply="${escapeHtml(replyId)}" data-comment="${escapeHtml(c.id)}" data-name="${escapeHtml(user.nickname || '')}">回复</button>
      ${isAuthor ? `<button class="link-btn danger-link" onclick="deleteComment('${escapeHtml(replyId)}','${escapeHtml(c.id)}')">删除</button>` : ''}
    </div>
  </div>`;
}

/* comment expand / reply form event delegation */
document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;

  if (action === 'expand-comments') {
    const replyId = target.dataset.reply;
    const zone = $(`[data-comments-for="${CSS.escape(replyId)}"]`);
    if (!zone) return;
    zone.innerHTML = '<div style="padding:10px 0"><div class="spinner" style="width:18px;height:18px"></div></div>';
    try {
      const data = await api(`/api/comments?reply_id=${encodeURIComponent(replyId)}&limit=100&offset=0`);
      state.commentsCache[replyId] = data.items || [];
      zone.dataset.loaded = '1';
      zone.innerHTML = state.commentsCache[replyId].map((c) => commentHTML(replyId, c)).join('');
    } catch (err) {
      toast(err.message, true);
      renderComments({ id: replyId, n_comments: 1, earliest_comments: [] }, zone);
    }
    return;
  }

  if (action === 'reply-form') {
    const replyId = target.dataset.reply;
    const replyItem = target.closest('.reply-item');
    if (!replyItem) return;
    const existing = replyItem.querySelector('.mini-form');
    if (existing) {
      existing.remove();
      return;
    }
    const form = buildMiniForm(replyId, 0, '回复该回帖…');
    target.closest('.reply-head').after(form);
    form.querySelector('textarea').focus();
    return;
  }

  if (action === 'comment-form') {
    const replyId = target.dataset.reply;
    const commentId = target.dataset.comment;
    const name = target.dataset.name || '';
    const commentItem = target.closest('.comment-item');
    if (!commentItem) return;
    const existing = commentItem.querySelector('.mini-form');
    if (existing) {
      existing.remove();
      return;
    }
    const form = buildMiniForm(replyId, commentId, `回复 @${name}…`);
    commentItem.appendChild(form);
    form.querySelector('textarea').focus();
  }
});

function buildMiniForm(replyId, parentId, placeholder) {
  const wrap = document.createElement('div');
  wrap.className = 'mini-form';
  wrap.innerHTML = `
    <textarea placeholder="${escapeHtml(placeholder)}" rows="2"></textarea>
    <button class="btn btn-primary" type="button">发送</button>
  `;
  const btn = wrap.querySelector('button');
  btn.addEventListener('click', async () => {
    const text = textToHtml((wrap.querySelector('textarea').value || '').trim());
    if (!text) {
      toast('内容不能为空', true);
      return;
    }
    btn.disabled = true;
    try {
      const body = { reply_id: replyId, content: text };
      if (parentId) body.parent_id = parentId;
      await api('/api/comment', { method: 'POST', body });
      toast('回复成功');
      wrap.remove();
      await loadReplies(true);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  return wrap;
}

/* ---------- router ---------- */
async function renderApp() {
  const app = $('#app');
  const path = normalizePath();

  if (!state.user && path !== '/' && path !== '/index.php' && !path.startsWith('/tie/')) {
    // unknown route, keep on home
    history.replaceState({}, '', '/');
  }

  // store redirect if a logged-in-only page is requested while logged out
  if (!state.user && path.startsWith('/tie/')) {
    state.redirect = path;
  } else if (!state.user && (path === '/' || path === '/index.php')) {
    state.redirect = '/';
  }

  app.innerHTML = headerHTML();
  bindHeader();

  if (!state.user) {
    app.insertAdjacentHTML('beforeend', loginHTML());
    bindLogin();
    return;
  }

  if (path.startsWith('/tie/')) {
    const postId = decodeURIComponent(path.slice(5));
    if (!postId) {
      go('/');
      return;
    }
    await renderPost(postId);
    return;
  }

  // default: home
  await renderHome();
}

/* ---------- init ---------- */
(async function init() {
  document.documentElement.dataset.theme = 'dark';
  applySettings();
  const edgeSettings = $('#edgeSettings');
  if (edgeSettings) edgeSettings.addEventListener('click', () => openSettings());
  try {
    const data = await api('/api/session');
    state.user = data.user || null;
  } catch (e) {
    state.user = null;
  }
  await renderApp();
})();

window.go = go;
window.logout = logout;
  