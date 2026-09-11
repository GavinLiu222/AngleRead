/* 纯表现层：滚动入场编排、侧栏抽屉、可关闭的提示条。
   不参与任何业务逻辑，移除本文件也不影响应用功能。 */

const root = document.documentElement;
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------------- 滚动入场（IntersectionObserver，绝不监听 scroll） ---------------- */

const REVEAL_SELECTOR = [
  '.view-head',
  '.notice',
  '.stat-grid',
  '.panel',
  '.dropzone',
  '.file-item',
  '.results-toolbar',
  '.paper-card',
  '.chat-empty',
  '.chat-container',
  '.results-list > .empty-state',
  '.sticky-actions',
  '.view > .actions',
].join(',');

if ('IntersectionObserver' in window && !reduced) {
  root.classList.add('motion-ready');

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.04 },
  );

  const observe = (el) => {
    if (el.dataset.revealBound) return;
    el.dataset.revealBound = '1';
    const siblings = el.parentElement
      ? [...el.parentElement.children].filter((c) => c.matches?.(REVEAL_SELECTOR))
      : [];
    const i = Math.min(siblings.indexOf(el), 6);
    if (i > 0) el.style.setProperty('--reveal-i', String(i));
    el.classList.add('reveal');
    io.observe(el);
  };

  const scan = (scope) => {
    if (scope.nodeType !== 1) return;
    if (scope.matches?.(REVEAL_SELECTOR)) observe(scope);
    scope.querySelectorAll?.(REVEAL_SELECTOR).forEach(observe);
  };

  scan(document.body);

  // 视图内容由 JS 动态生成，新节点同样纳入编排
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) scan(node);
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* 安全兜底：若渲染被挂起（后台标签页、被遮挡窗口）导致观察者未回调，
     在页面重新可见 / 加载完成时补齐视口内元素，绝不让内容停留在不可见状态。 */
  const sweep = () => {
    for (const el of document.querySelectorAll('.reveal:not(.in)')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < window.innerHeight && r.bottom > 0) {
        el.classList.add('in');
        io.unobserve(el);
      }
    }
  };
  window.addEventListener('load', sweep);
  window.addEventListener('pageshow', sweep);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sweep();
  });
}

/* ---------------- 侧栏：窄屏抽屉 ---------------- */

const navToggle = document.getElementById('navToggle');
const tabs = document.getElementById('tabs');

function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  navToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

navToggle?.addEventListener('click', () => {
  setNav(!document.body.classList.contains('nav-open'));
});

// 点击任意导航项后收起（视图切换本身由 main.js 处理）
tabs?.addEventListener('click', (e) => {
  if (e.target.closest('.tab')) setNav(false);
});

document.querySelector('[data-dismiss="nav"]')?.addEventListener('click', () => setNav(false));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setNav(false);
});

window.matchMedia('(min-width: 901px)').addEventListener?.('change', (e) => {
  if (e.matches) setNav(false);
});

// 侧栏底部的连接状态块 → Settings
document.getElementById('connStatus')?.addEventListener('click', () => {
  document.querySelector('.tab[data-view="settings"]')?.click();
});

/* ---------------- 可关闭的提示条（关闭状态记在本机） ---------------- */

const DISMISS_KEY = 'thesisReader.dismissedNotices';

function readDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(set) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
  } catch {
    /* 隐私模式下写入失败无所谓，本次会话内关闭即可 */
  }
}

const dismissed = readDismissed();

function noticeKey(el) {
  return el.id || el.dataset.notice || '';
}

for (const el of document.querySelectorAll('.announce, .notice')) {
  const key = noticeKey(el);
  if (key && dismissed.has(key)) el.hidden = true;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dismiss="announce"], [data-dismiss="notice"]');
  if (!btn) return;
  const box = btn.closest('.announce, .notice');
  if (!box) return;
  box.hidden = true;
  const key = noticeKey(box);
  if (key) {
    dismissed.add(key);
    writeDismissed(dismissed);
  }
});
