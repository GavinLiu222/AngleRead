/* 纯表现层：滚动入场编排、导航岛屿展开、CTA 磁吸微交互。
   不参与任何业务逻辑，移除本文件也不影响应用功能。 */

const root = document.documentElement;
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/* ---------------- 滚动入场（IntersectionObserver，绝不监听 scroll） ---------------- */

const REVEAL_SELECTOR = [
  '.view-head',
  '.profile-bar',
  '.form-grid',
  '.auto-suggest-row',
  '.section-item',
  '.section-editor + .actions',
  '.sticky-actions',
  '.dropzone',
  '.file-item',
  '.paper-card',
  '.chat-empty',
  '.chat-container',
  '.results-list > .empty-state',
  '.view > h3',
  '.view > h3 + .hint',
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

/* ---------------- 流体导航岛屿（窄屏汉堡 → 全屏玻璃层） ---------------- */

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setNav(false);
});

window.matchMedia('(min-width: 768px)').addEventListener?.('change', (e) => {
  if (e.matches) setNav(false);
});

/* ---------------- CTA 磁吸物理（仅精确指针；写入自定义属性，由 CSS 合成 transform） ---------------- */

if (fine && !reduced) {
  const SELECTOR = 'button.primary:not(:disabled), button.ghost:not(:disabled), .tab';
  const MAX_X = 4;
  const MAX_Y = 2.4;

  let target = null;
  let pointer = null;
  let frame = 0;

  const release = (el) => {
    if (!el) return;
    el.style.removeProperty('--mx');
    el.style.removeProperty('--my');
  };

  // 每帧至多一次读 + 一次写，且仅在指针停留于按钮上时运行
  const apply = () => {
    frame = 0;
    if (!target || !pointer) return;
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dx = ((pointer.x - (r.left + r.width / 2)) / (r.width / 2)) * MAX_X;
    const dy = ((pointer.y - (r.top + r.height / 2)) / (r.height / 2)) * MAX_Y;
    target.style.setProperty('--mx', dx.toFixed(2) + 'px');
    target.style.setProperty('--my', dy.toFixed(2) + 'px');
  };

  const drop = () => {
    release(target);
    target = null;
    pointer = null;
  };

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.(SELECTOR) || null;
    if (el === target) return;
    release(target);
    target = el;
  });

  document.addEventListener('pointermove', (e) => {
    if (!target) return;
    pointer = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(apply);
  });

  document.addEventListener('pointerout', (e) => {
    if (target && !target.contains(e.relatedTarget)) drop();
  });
  window.addEventListener('blur', drop);
}
