// static/src/bsky-client.js を読み込み（Hugo は static/ 以下をルートとして配信するよ）
import { createBskyClient } from '/src/bsky-client.js';
import { initI18n, t, formatDate, formatRelativeTime, formatCompactNumber, setLocale, getCurrentLocale } from '/src/i18n.js';

// ============================================================================
// 定数・設定
// ============================================================================
const MAX_IMAGES = 4;
const MAX_POST_GRAPHEMES = 300;
const ERROR_DISPLAY_DURATION = 5000;
const SUCCESS_DISPLAY_DURATION = 3000;

/**
 * Grapheme（ユーザーが認識する文字）の数を数える
 * 絵文字、結合文字などを1文字として数える
 * @param {string} text - 数えるテキスト
 * @returns {number} グラフェムの数
 */
function countGraphemes(text) {
  if (!text) return 0;
  
  // 正規表現を使ってグラフェムクラスターを分割
  // この実装は基本的な絵文字と結合文字に対応
  const graphemeRegex = /[\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?=[^\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g;
  const matches = text.match(graphemeRegex);
  return matches ? matches.length : 0;
}

// ============================================================================
// クライアント初期化
// ============================================================================
const client = createBskyClient();

// ============================================================================
// DOM 要素のキャッシュ
// ============================================================================
const elements = {
  loginBtn: document.getElementById('loginBtn'),
  timelineCard: document.getElementById('timeline-card'),
  notificationsCard: document.getElementById('notifications-card'),
  refreshBtn: document.getElementById('refreshBtn'),
  seeMoreBtn: document.getElementById('seeMoreBtn'),
  timelineBottom: document.getElementById('timelineBottom'),
  logoutBtn: document.getElementById('logoutBtn'),
  notificationsRefreshBtn: document.getElementById('notificationsRefreshBtn'),
  notificationsSeenBtn: document.getElementById('notificationsSeenBtn'),
  postBtn: document.getElementById('postBtn'),
  imageUploadBtn: document.getElementById('imageUploadBtn'),
  imageInput: document.getElementById('imageInput'),
  imageCount: document.getElementById('imageCount'),
  imagePreview: document.getElementById('imagePreview'),
  loading: document.getElementById('loading'),
  errorMessage: document.getElementById('errorMessage'),
  settingsCard: document.getElementById('settings-card'),
  clearCacheBtn: document.getElementById('clearCacheBtn'),
  clearCookiesBtn: document.getElementById('clearCookiesBtn'),
  loginCard: document.getElementById('login'),
  timeline: document.getElementById('timeline'),
  notifications: document.getElementById('notifications'),
  postText: document.getElementById('postText'),
};

// ============================================================================
// アプリケーション状態
// ============================================================================
let timelineLoading = false;
let timelineCursor = null;
let timelineHasMore = false;
let notificationsLoading = false;
let selectedImages = [];
let menuRepositionFrame = null;

function repositionOpenMenus() {
  menuRepositionFrame = null;
  document.querySelectorAll('#menu-overlay-container md-menu').forEach((menu) => {
    if (menu.open) menu.reposition();
  });
}

function queueMenuReposition() {
  if (menuRepositionFrame !== null) return;
  menuRepositionFrame = window.requestAnimationFrame(repositionOpenMenus);
}

window.addEventListener('resize', queueMenuReposition, { passive: true });

// エラーメッセージ表示関数（i18n 対応）
function showError(messageKey, params = {}) {
  if (!errorMessage) return;
  const message = t(messageKey, params);
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 5000);
}

// 成功メッセージ表示関数（i18n 対応）
function showSuccess(messageKey, params = {}) {
  if (!errorMessage) return;
  const message = t(messageKey, params);
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  
  errorMessage.style.background = 'var(--md-sys-color-primary-container, #bbdefb)';
  errorMessage.style.color = 'var(--md-sys-color-on-primary-container, #0d47a1)';
  
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, SUCCESS_DISPLAY_DURATION);
}

/**
 * ローディング表示の切り替え
 */
function showLoading(show) {
  const { loading } = elements;
  if (!loading) return;
  loading.style.display = show ? 'block' : 'none';
}

/**
 * パスの正規化（末尾のスラッシュ確保）
 */
function normalizePath(pathname) {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/**
 * クライアントサイドナビゲーション
 */
function navigateTo(path) {
  const target = normalizePath(path);
  if (normalizePath(window.location.pathname) !== target) {
    window.history.pushState({}, '', target);
    initializeView();
  }
}

/**
 * ナビゲーションイベントの処理可否判定
 */
function shouldHandleClientNavigation(event) {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * カードの表示/非表示を管理
 */
function showCard(activeCardId) {
  const cardStates = {
    login: activeCardId === 'login',
    timeline: activeCardId === 'timeline',
    notifications: activeCardId === 'notifications',
    settings: activeCardId === 'settings',
  };
  
  Object.entries(cardStates).forEach(([key, isVisible]) => {
    const card = elements[`${key}Card`];
    if (!card) return;
    
    card.hidden = !isVisible;
    card.style.display = isVisible ? 'block' : 'none';
  });
}

bootstrap();

window.addEventListener('popstate', () => {
  initializeView();
});

document.querySelectorAll('.sidebar-nav md-text-button').forEach((link) => {
  link.addEventListener('mouseenter', () => {
    // SPA では HTML ドキュメントの prefetch は不要。ナビゲーションはクライアント側で処理されるため
    // 代わりに必要に応じてデータのみを事前ロードする
  }, { passive: true });

  link.addEventListener('click', (event) => {
    if (!shouldHandleClientNavigation(event)) return;
    const href = link.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    navigateTo(href);
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.body.classList.add('sidebar-collapsed');
    }
  });
});


async function bootstrap() {
  try {
    // i18n を初期化
    await initI18n();
    
    await client.ready();
  } catch (e) {
    console.error('Client initialization failed:', e);
    // セッション復元に失敗してもアプリは続行（未ログイン状態として扱う）
  }
  initializeView();
}

if (loginBtn) loginBtn.addEventListener('click', async () => {
  const id = document.getElementById('id').value.trim();
  const pw = document.getElementById('pw').value.trim();
  const pds = document.getElementById('pds').value.trim();
  
  if (!id || !pw || !pds) {
    showError('login.required');
    return;
  }
  
  loginBtn.disabled = true;
  showLoading(true);
  
  try {
    await client.login(id, pw, pds);
    // Reload and replace the login entry so browser back cannot return to it.
    window.location.replace('/home/');
  } catch (e) {
    showError('errors.loginFailed');
  } finally {
    loginBtn.disabled = false;
    showLoading(false);
  }
});

if (refreshBtn) refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  await loadTimeline(true);
  refreshBtn.disabled = false;
});

if (seeMoreBtn) seeMoreBtn.addEventListener('click', async () => {
  seeMoreBtn.disabled = true;
  await loadTimeline(false, true);
  seeMoreBtn.disabled = false;
});

if (notificationsRefreshBtn) notificationsRefreshBtn.addEventListener('click', async () => {
  notificationsRefreshBtn.disabled = true;
  try {
    await loadNotifications();
  } catch (e) {
    showError('errors.fetchFailed');
  } finally {
    notificationsRefreshBtn.disabled = false;
  }
});

if (notificationsSeenBtn) notificationsSeenBtn.addEventListener('click', async () => {
  notificationsSeenBtn.disabled = true;
  try {
    await client.markNotificationsSeen();
    await loadNotifications();
    showSuccess('notifications.markedAsSeen');
  } catch (e) {
    showError('errors.notificationFailed');
  } finally {
    notificationsSeenBtn.disabled = false;
  }
});

if (logoutBtn) logoutBtn.addEventListener('click', async () => {
  await client.logout();
  navigateTo("/login/");
  showLogin();
  syncSidebarByAuthState();
});

// 言語切り替え機能
const localeSelect = document.getElementById('localeSelect');

function syncLocaleSelect() {
  if (!localeSelect) return;
  const current = getCurrentLocale();
  localeSelect.value = current;
}

async function handleLocaleChange(locale) {
  if (!locale) return;
  try {
    await setLocale(locale);
    // 翻訳が反映された状態でページ全体を再読み込み
    location.reload();
  } catch (e) {
    console.error('Locale change failed:', e);
    showError('errors.localeChangeFailed');
  }
}

if (localeSelect) {
  localeSelect.addEventListener('change', () => {
    handleLocaleChange(localeSelect.value);
  });
}

if (clearCacheBtn) clearCacheBtn.addEventListener('click', async () => {
  clearCacheBtn.disabled = true;
  try {
    let cleared = false;
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
      cleared = true;
    }
    
    if (cleared) {
      showSuccess('settings.cacheCleared');
    } else {
    showError('errors.cacheNotSupported');
    }
  } catch (e) {
    showError('errors.cacheDeleteError');
  } finally {
    clearCacheBtn.disabled = false;
  }
});

if (clearCookiesBtn) clearCookiesBtn.addEventListener('click', async () => {
  if (!confirm('本当にCookieを全削除しますか？\n（実行するとログアウトされます）')) {
    return;
  }
  clearCookiesBtn.disabled = true;
  try {
    if (client.isLoggedIn) {
      await client.logout();
    }
    
    // 全Cookie削除
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i];
      const eqPos = cookie.indexOf("=");
      const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
      const trimmedName = name.trim();
      document.cookie = `${trimmedName}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      document.cookie = `${trimmedName}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;Secure;SameSite=Lax`;
    }
    
    showSuccess('settings.cookiesCleared');
    setTimeout(() => {
      window.location.href = '/login/';
    }, 1500);
  } catch (e) {
    showError('errors.cookieDeleteError');
    clearCookiesBtn.disabled = false;
  }
});

/**
 * 投稿処理の設定
 */
function setupPostHandler() {
  const { postBtn, postText } = elements;
  if (!postBtn) return;

  postBtn.addEventListener('click', async () => {
    const text = getPostText(postText);

    if (!text && selectedImages.length === 0) {
      showError('post.required');
      return;
    }

    // グラフェム数をチェック
    const graphemeCount = countGraphemes(text);
    if (graphemeCount > MAX_POST_GRAPHEMES) {
      showError('errors.graphemeLimit', { count: graphemeCount });
      return;
    }

    postBtn.disabled = true;
    postBtn.textContent = t('post.posting');

    try {
      console.log('投稿開始:', { text, imageCount: selectedImages.length, graphemeCount });

      if (selectedImages.length > 0) {
        await client.postWithImage(text, selectedImages);
        selectedImages = [];
        updateImagePreview();
      } else {
        await client.post(text);
      }

      clearPostText(postText);
      showSuccess('投稿しました！');
      await loadTimeline(true);
    } catch (e) {
      console.error('投稿エラー詳細:', e);
      showError(`投稿エラー：${e.message}`);
    } finally {
      postBtn.disabled = false;
      postBtn.innerHTML = '<md-icon slot="icon">send</md-icon>' + t('post.submit');
    }
  });
}

/**
 * 投稿テキストの取得（shadow DOM 対応）
 */
function getPostText(postTextField) {
  if (postTextField?.value) {
    return postTextField.value.trim();
  }

  // shadow DOM 内の textarea から直接取得
  const textarea = postTextField?.querySelector('textarea') ||
                   postTextField?.shadowRoot?.querySelector('textarea') ||
                   postTextField?.shadowRoot?.querySelector('input');
  return textarea ? textarea.value.trim() : '';
}

/**
 * 投稿テキストのクリア（shadow DOM 対応）
 */
function clearPostText(postTextField) {
  if (postTextField?.value) {
    postTextField.value = '';
  } else {
    const textarea = postTextField?.querySelector('textarea') || 
                     postTextField?.shadowRoot?.querySelector('textarea');
    if (textarea) textarea.value = '';
  }
}

setupPostHandler();

/**
 * 画像アップロードボタンの設定
 */
if (elements.imageUploadBtn) {
  elements.imageUploadBtn.addEventListener('click', () => {
    elements.imageInput.click();
  });
}

/**
 * 画像選択時の処理
 */
if (elements.imageInput) {
  elements.imageInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    const remainingSlots = MAX_IMAGES - selectedImages.length;
    const filesToAdd = files.slice(0, remainingSlots);
    
    if (files.length > remainingSlots) {
      showError(`画像は最大${MAX_IMAGES}枚まで添付できます。残り${remainingSlots}枚です。`);
    }
    
    filesToAdd.forEach(file => {
      selectedImages.push(file);
    });
    
    updateImagePreview();
    elements.imageInput.value = '';
  });
}

/**
 * 画像プレビューの更新
 */
function updateImagePreview() {
  const { imagePreview, imageCount } = elements;
  
  // 既存の画像 URL を解放
  Array.from(imagePreview.querySelectorAll('img')).forEach((img) => {
    if (img.dataset.objectUrl) {
      URL.revokeObjectURL(img.dataset.objectUrl);
    }
  });
  
  imagePreview.innerHTML = '';
  imageCount.textContent = selectedImages.length > 0 ? t('post.imageCountSelected', { count: selectedImages.length }) : '';
  
  selectedImages.forEach((file, index) => {
    const container = createImagePreviewItem(file, index);
    imagePreview.appendChild(container);
  });
}

/**
 * 画像プレビューアイテムの作成
 */
function createImagePreviewItem(file, index) {
  const container = document.createElement('div');
  container.style.position = 'relative';
  
  const img = document.createElement('img');
  const objectUrl = URL.createObjectURL(file);
  img.src = objectUrl;
  img.dataset.objectUrl = objectUrl;
  img.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:8px;';
  
  const removeBtn = createImageRemoveButton(index);
  
  container.appendChild(img);
  container.appendChild(removeBtn);
  return container;
}

/**
 * 画像削除ボタンの作成
 */
function createImageRemoveButton(index) {
  const removeBtn = document.createElement('md-icon-button');
  const icon = document.createElement('md-icon');
  icon.textContent = 'close';
  removeBtn.appendChild(icon);
  removeBtn.style.cssText = 'position:absolute;top:-8px;right:-8px;background-color:var(--md-sys-color-error);color:white;border-radius:50%;width:24px;height:24px;font-size:16px;';
  
  removeBtn.addEventListener('click', () => {
    selectedImages.splice(index, 1);
    updateImagePreview();
  });
  
  return removeBtn;
}


/**
 * リプライスレッドの投稿を取得
 */
function getReplyThreadPosts(reply) {
  if (!reply) return [];
  
  const posts = [];
  const { root, parent } = reply;

  if (root?.uri && root.uri !== parent?.uri) {
    posts.push(root);
  }
  if (parent?.uri) {
    posts.push(parent);
  }

  return posts;
}

/**
 * 著者情報行の作成
 */
function createAuthorLine(author = {}, fallbackName = '', nameTypeClass = 'md-typescale-body-large') {
  const authorLine = document.createElement('div');
  authorLine.className = 'post-author-line';

  const displayName = document.createElement('span');
  displayName.className = `post-author-name ${nameTypeClass}`;
  displayName.textContent = author.displayName || author.handle || (fallbackName ? t(fallbackName) : t('post.authorFallback'));
  authorLine.appendChild(displayName);

  if (author.handle) {
    const authorId = document.createElement('span');
    authorId.className = 'post-author-id md-typescale-body-small';
    authorId.textContent = `@${author.handle}`;
    authorLine.appendChild(authorId);
  }

  return authorLine;
}

/**
 * リプライスレッドの追加
 */
function appendReplyThread(supporting, reply) {
  const replyPosts = getReplyThreadPosts(reply);
  if (replyPosts.length === 0) return;

  const threadContainer = createReplyThreadContainer();

  replyPosts.forEach((replyPost) => {
    const card = createReplyCard(replyPost);
    threadContainer.appendChild(card);
  });

  supporting.appendChild(threadContainer);
}

/**
 * リプライスレッドコンテナの作成
 */
function createReplyThreadContainer() {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:10px;padding-left:10px;border-left:3px solid var(--md-sys-color-outline);';
  return container;
}

/**
 * リプライカードの作成
 */
function createReplyCard(replyPost) {
  const replyRecord = replyPost.record || {};
  const replyAuthor = replyPost.author || {};

  const card = document.createElement('div');
  card.style.cssText = 'padding:8px;border-radius:12px;background:var(--md-sys-color-surface-container-high);';

  const author = createAuthorLine(replyAuthor, t('post.replyAuthorFallback'), 'md-typescale-body-small');

  const text = document.createElement('div');
  text.className = 'md-typescale-body-small';
  text.style.whiteSpace = 'pre-wrap';
  text.textContent = replyRecord.text || '';

  card.appendChild(author);
  if (text.textContent) card.appendChild(text);
  return card;
}

/**
 * サイドバーの認証状態同期
 */
function syncSidebarByAuthState() {
  const loginNav = document.querySelector('[data-nav-item="login"]');
  const composerNav = document.querySelector('[data-nav-item="composer"]');
  const timelineNav = document.querySelector('[data-nav-item="timeline"]');
  const notificationsNav = document.querySelector('[data-nav-item="notifications"]');
  const settingsNav = document.querySelector('[data-nav-item="settings"]');

  const loggedIn = client.isLoggedIn;
  
  if (loginNav) {
    loginNav.style.display = loggedIn ? 'none' : 'flex';
    loginNav.setAttribute('aria-disabled', loggedIn ? 'true' : 'false');
  }

  [composerNav, timelineNav, notificationsNav].forEach((navItem) => {
    if (!navItem) return;
    navItem.style.display = loggedIn ? 'flex' : 'none';
    navItem.setAttribute('aria-disabled', loggedIn ? 'false' : 'true');
  });

  if (settingsNav) {
    settingsNav.style.display = 'flex';
    settingsNav.setAttribute('aria-disabled', 'false');
  }
}

/**
 * アクティブなサイドバーアイテムの設定
 */
function setActiveSidebarItem(key) {
  document.querySelectorAll('.sidebar-nav md-text-button').forEach((link) => {
    link.classList.toggle('active', link.dataset.navItem === key);
  });
}

/**
 * ビューの初期化（ルーティング）
 */
function initializeView() {
  syncSidebarByAuthState();
  const path = normalizePath(window.location.pathname);

  const routeHandlers = {
    '/settings/': () => showSettings(),
    '/home/': () => client.isLoggedIn ? showTimeline() : navigateToLogin(),
    '/notifications/': () => client.isLoggedIn ? showNotifications() : navigateToLogin(),
    '/login/': () => client.isLoggedIn ? navigateToHome() : showLogin(),
  };

  const handler = routeHandlers[path];
  if (handler) {
    handler();
    return;
  }

  // デフォルトルート
  if (client.isLoggedIn) {
    navigateToHome();
  } else {
    navigateToLogin();
  }
}

function navigateToLogin() {
  navigateTo('/login/');
  showLogin();
}

function navigateToHome() {
  navigateTo('/home/');
  showTimeline();
}

/**
 * ログイン画面表示
 */
function showLogin() {
  showCard('login');
  setActiveSidebarItem('login');
}

/**
 * タイムライン画面表示
 */
function showTimeline() {
  showCard('timeline');
  setActiveSidebarItem('timeline');
  loadTimeline();
}

/**
 * 通知画面表示
 */
function showNotifications() {
  showCard('notifications');
  setActiveSidebarItem('notifications');
  loadNotifications();
}

/**
 * 設定画面表示
 */
function showSettings() {
  showCard('settings');
  setActiveSidebarItem('settings');
  syncLocaleSelect();
}

async function loadTimeline(force = false, append = false) {
  if (timelineLoading) return;
  if (append && !timelineHasMore) return;

  timelineLoading = true;
  showLoading(true);
  updateSeeMoreButton(true);
  try {
    await client.syncBookmarks();
    const page = append
      ? await client.timelinePage(20, { cursor: timelineCursor })
      : await client.timelinePage(20, { force });
    const feed = page.feed || [];
    timelineCursor = page.cursor;
    timelineHasMore = Boolean(page.cursor);

    const container = document.getElementById('timeline');
    if (!container) return;

    const existingPostUris = new Set(
      Array.from(container.querySelectorAll('md-list-item[data-post-uri]'))
        .map((item) => item.dataset.postUri)
    );

    if (feed.length === 0 && container.children.length > 0) {
      showError(append ? 'notifications.noMorePosts' : 'notifications.noNewPosts');
      return;
    }

    // リストアイテムを生成
    const fragment = document.createDocumentFragment();
    const menuFragment = document.createDocumentFragment();

    // 🔹 md-menu用のオーバーレイコンテナの準備・クリーンアップ
    let menuContainer = document.getElementById('menu-overlay-container');
    if (!menuContainer) {
      menuContainer = document.createElement('div');
      menuContainer.id = 'menu-overlay-container';
      document.body.appendChild(menuContainer);
    }
    feed.forEach(item => {
      const post = item.post;
      if (!post?.uri || existingPostUris.has(post.uri)) return;
      existingPostUris.add(post.uri);
      const record = post.record || {};
      const reason = item.reason;
      const isRepost = reason?.$type === 'app.bsky.feed.defs#reasonRepost';
      const reposterHandle = reason?.by?.handle;
      const reposterName = reason?.by?.displayName || (reposterHandle ? `@${reposterHandle}` : null);
      
      // メインのリストアイテム作成
      const listItem = document.createElement('md-list-item');
      listItem.type = 'link';
      listItem.dataset.postUri = post.uri;

      // 「〇〇による拡散」表示
      if (isRepost && reposterName) {
        const overline = document.createElement('div');
        overline.slot = 'overline';
        overline.className = 'md-typescale-body-small';
        overline.style.display = 'flex';
        overline.style.alignItems = 'center';
        overline.style.gap = '4px';

        const repostIcon = document.createElement('md-icon');
        repostIcon.textContent = 'repeat';
        repostIcon.style.fontSize = '16px';

        const repostLabel = document.createElement('span');
        repostLabel.textContent = t('post.repostedBy', { name: reposterName });

        overline.appendChild(repostIcon);
        overline.appendChild(repostLabel);
        listItem.appendChild(overline);
      }
      
      // アイコンスロット
      const avatarIcon = document.createElement('md-icon');
      avatarIcon.slot = 'start';
      avatarIcon.textContent = 'account_circle';
      
      // ヘッドライン
      const headline = createAuthorLine(post.author);
      headline.slot = 'headline';
      
      // サポーティングテキスト
      const supporting = document.createElement('div');
      supporting.slot = 'supporting-text';
      supporting.className = 'md-typescale-body-medium';

      appendReplyThread(supporting, item.reply);

      const bodyText = document.createElement('div');
      bodyText.style.whiteSpace = 'pre-wrap';
      bodyText.textContent = record.text;
      supporting.appendChild(bodyText);

      const actionRow = document.createElement('div');
      actionRow.style.display = 'flex';
      actionRow.style.gap = '8px';
      actionRow.style.alignItems = 'center';
      actionRow.style.marginTop = '8px';
      actionRow.style.flexWrap = 'wrap';

      const formatCountBadge = (count) => {
        if (count === null || count === undefined || count <= 0) return '';
        const formattedCount = formatCompactNumber(count);
        return `<span class="action-count">${formattedCount}</span>`;
      };

      const createActionButton = (icon, iconClass = '', count = null) => {
        const btn = document.createElement('md-text-button');
        const countStr = formatCountBadge(count);
        btn.innerHTML = `<md-icon class="${iconClass}" slot="icon">${icon}</md-icon>${countStr}`;
        return btn;
      };

      const replyCount = post.replyCount ?? null;
      const replyBtn = createActionButton('reply', '', replyCount);
      replyBtn.addEventListener('click', async () => {
        const text = window.prompt(t('post.replyPrompt'));
        if (!text || !text.trim()) return;
        replyBtn.disabled = true;
        try {
          await client.reply(post.uri, post.cid, text.trim(), record.reply);
          showSuccess('post.replied');
          await loadTimeline(true);
        } catch (e) {
          showError('errors.replyFailed');
        } finally {
          replyBtn.disabled = false;
        }
      });

      const viewer = post.viewer || {};

      const repostWrap = document.createElement('div');
      repostWrap.style.position = 'relative';
      let reposted = Boolean(viewer.repost);
      let repostRecordUri = viewer.repost || null;
      const repostCount = post.repostCount ?? null;
      const repostBtn = createActionButton('repeat', 'repost-icon', repostCount);
      if (reposted) {
        const repostIcon = repostBtn.querySelector('.repost-icon');
        if (repostIcon) repostIcon.classList.add('is-filled');
        repostIcon.textContent = 'repeat_on';
      }

      // 🔹 リポスト用メニューの作成 (Body直下のオーバーレイコンテナに置くことで、見切れを防ぐよ！)
      const repostMenu = document.createElement('md-menu');
      repostMenu.anchorElement = repostBtn; // MWCに直接ボタンの要素を教える！
      repostMenu.menuCorner = 'start-start';
      repostMenu.anchorCorner = 'end-start'; // ボタンの左下にメニューを出す設定
      repostMenu.positioning = 'document';

      const doRepostItem = document.createElement('md-menu-item');
      doRepostItem.dataset.action = 'repost';
      doRepostItem.innerHTML = `
        <md-icon slot="start">repeat</md-icon>
        <div slot="headline">拡散</div>
      `;

      const quoteItem = document.createElement('md-menu-item');
      quoteItem.dataset.action = 'quote';
      quoteItem.innerHTML = `
        <md-icon slot="start">format_quote</md-icon>
        <div slot="headline">引用</div>
      `;

      repostBtn.addEventListener('click', () => {
        // 座標計算はMWCに丸投げ！開閉するだけでOK
        repostMenu.open = !repostMenu.open;
      });

      async function handleRepost() {
        doRepostItem.disabled = true;
        try {
          if (reposted) {
            await client.unrepost(repostRecordUri);
            reposted = false;
            repostRecordUri = null;
            const countStr = formatCountBadge(repostCount);
            repostBtn.innerHTML = `<md-icon class="repost-icon" slot="icon">repeat</md-icon>${countStr}`;
            showError('post.repostRemoved');
          } else {
            const res = await client.repost(post.uri, post.cid);
            reposted = true;
            repostRecordUri = res?.data?.uri || null;
            const newCount = (repostCount ?? 0) + 1;
            const countStr = formatCountBadge(newCount);
            repostBtn.innerHTML = `<md-icon class="repost-icon is-filled" slot="icon">repeat_on</md-icon>${countStr}`;
            showError('post.reposted');
          }
          repostMenu.open = false;
          await loadTimeline(true);
        } catch (e) {
          showError('errors.repostFailed');
        } finally {
          doRepostItem.disabled = false;
        }
      }

      async function handleQuote() {
        const text = window.prompt(t('post.quotePrompt'));
        if (!text || !text.trim()) return;
        quoteItem.disabled = true;
        try {
          await client.quote(post.uri, post.cid, text.trim());
          repostMenu.open = false;
          showError('post.quoted');
          await loadTimeline(true);
        } catch (e) {
          showError('errors.quoteFailed');
        } finally {
          quoteItem.disabled = false;
        }
      }
      repostMenu.addEventListener('close-menu', async (event) => {
        const action = event.detail?.itemPath?.[0]?.dataset?.action;
        if (action === 'repost') await handleRepost();
        if (action === 'quote') await handleQuote();
      });

      repostMenu.appendChild(doRepostItem);
      repostMenu.appendChild(quoteItem);
      
      // ボタンだけをタイムラインの中に配置
      repostWrap.appendChild(repostBtn);
      // メニュー本体はオーバーフローで切られないようにBodyのオーバーレイコンテナに流し込むよ
      menuFragment.appendChild(repostMenu);

      let liked = Boolean(viewer.like);
      let likeRecordUri = viewer.like || null;
      const likeCount = post.likeCount ?? null;
      const likeBtn = createActionButton('favorite', 'favorite-icon', likeCount);
      if (liked) {
        const likeIcon = likeBtn.querySelector('.favorite-icon');
        if (likeIcon) likeIcon.classList.add('is-filled');
      }
      let currentLikeCount = likeCount;
      likeBtn.addEventListener('click', async () => {
        likeBtn.disabled = true;
        try {
          if (liked) {
            await client.unlike(likeRecordUri);
            liked = false;
            likeRecordUri = null;
            currentLikeCount = Math.max(0, (currentLikeCount ?? 1) - 1);
            const countStr = formatCountBadge(currentLikeCount);
            likeBtn.innerHTML = `<md-icon class="favorite-icon" slot="icon">favorite</md-icon>${countStr}`;
            showError('post.likeRemoved');
          } else {
            const res = await client.like(post.uri, post.cid);
            liked = true;
            likeRecordUri = res?.data?.uri || null;
            currentLikeCount = (currentLikeCount ?? 0) + 1;
            const countStr = formatCountBadge(currentLikeCount);
            likeBtn.innerHTML = `<md-icon class="favorite-icon is-filled" slot="icon">favorite</md-icon>${countStr}`;
            showError('post.liked');
          }
        } catch (e) {
          showError('errors.likeFailed');
        } finally {
          likeBtn.disabled = false;
        }
      });

      let saved = client.isSaved(post.uri);
      const saveCount = null; // Bluesky APIでは保存数は非公開
      const saveBtn = createActionButton('bookmark', 'save-icon', saveCount);
      if (saved) {
        const saveIcon = saveBtn.querySelector('.save-icon');
        if (saveIcon) saveIcon.classList.add('is-filled');
      }
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        try {
          if (saved) {
            await client.unsave(post.uri, post.cid);
            saved = false;
            saveBtn.innerHTML = '<md-icon class="save-icon" slot="icon">bookmark</md-icon>';
            showError('post.saved');
          } else {
            await client.save(post.uri, post.cid);
            saved = true;
            saveBtn.innerHTML = '<md-icon class="save-icon is-filled" slot="icon">bookmark</md-icon>';
            showError('post.saved');
          }
        } catch (e) {
          showError('errors.saveFailed');
        } finally {
          saveBtn.disabled = false;
        }
      });

      actionRow.appendChild(replyBtn);
      actionRow.appendChild(repostWrap);
      actionRow.appendChild(likeBtn);
      actionRow.appendChild(saveBtn);
      supporting.appendChild(actionRow);

      // 画像がある場合は表示
      const images = post.embed?.images || record.embed?.images || [];
      if (images.length > 0) {
        const imageContainer = document.createElement('div');
        imageContainer.style.display = 'flex';
        imageContainer.style.gap = '8px';
        imageContainer.style.flexWrap = 'wrap';
        imageContainer.style.marginTop = '8px';
        
        images.forEach(img => {
          const imgElement = document.createElement('img');
          imgElement.src = img.fullsize || img.thumbnail;
          imgElement.style.width = '120px';
          imgElement.style.height = '120px';
          imgElement.style.objectFit = 'cover';
          imgElement.style.borderRadius = '8px';
          imgElement.style.cursor = 'pointer';
          
          imgElement.addEventListener('click', () => {
            window.open(img.fullsize || img.thumbnail, '_blank');
          });
          
          imageContainer.appendChild(imgElement);
        });
        
        supporting.appendChild(imageContainer);
      }

      listItem.appendChild(avatarIcon);
      listItem.appendChild(headline);
      listItem.appendChild(supporting);
      fragment.appendChild(listItem);

      const divider = document.createElement('md-divider');
      fragment.appendChild(divider);
    });

    if (fragment.childNodes.length === 0) {
      showError(append ? 'notifications.noMorePosts' : 'notifications.noNewPosts');
      return;
    }

    if (append) {
      container.appendChild(fragment);
    } else {
      container.insertBefore(fragment, container.firstChild);
    }
    menuContainer.appendChild(menuFragment);
  } catch (e) {
    console.error('Timeline load error:', e);
    showError('errors.fetchFailed');
  } finally {
    showLoading(false);
    timelineLoading = false;
    updateSeeMoreButton(false);
  }
}


function getNotificationReasonLabel(reason) {
  const keyMap = {
    like: 'notification.label.like',
    repost: 'notification.label.repost',
    follow: 'notification.label.follow',
    mention: 'notification.label.mention',
    reply: 'notification.label.reply',
    quote: 'notification.label.quote'
  };
  const key = keyMap[reason];
  return key ? t(key) : t('notification.label.fallback');
}

function appendNotificationActions(supporting, notification) {
  const post = notification.post;
  if (!post?.uri || !post.cid) return;

  const actionRow = document.createElement('div');
  actionRow.style.display = 'flex';
  actionRow.style.gap = '8px';
  actionRow.style.alignItems = 'center';
  actionRow.style.marginTop = '10px';
  actionRow.style.flexWrap = 'wrap';

  const createButton = (icon, count) => {
    const button = document.createElement('md-filled-tonal-button');
    button.innerHTML = `<md-icon slot="icon">${icon}</md-icon>${count > 0 ? `<span class="action-count">${count >= 1000 ? `${(count / 1000).toFixed(1)}K` : count}</span>` : ''}`;
    return button;
  };

  const replyButton = createButton('reply', post.replyCount ?? 0);
  replyButton.addEventListener('click', async () => {
    const text = window.prompt(t('post.replyPrompt'));
    if (!text || !text.trim()) return;
    replyButton.disabled = true;
    try {
      const trimmed = text.trim();
      const record = notification.record;

      // Build reply context: new reply's parent is the reply record,
      // root is the thread root (from record.reply.root) or the reply record itself
      const root = record?.reply?.root || { uri: notification.uri, cid: notification.cid };
      const parent = { uri: notification.uri, cid: notification.cid };

      await client.reply(parent.uri, parent.cid, trimmed, { root, parent });
      showSuccess('post.replied');
      await loadNotifications();
    } catch (e) {
      showError('errors.replyFailed');
    } finally {
      replyButton.disabled = false;
    }
  });

  const viewer = post.viewer || {};
  let liked = Boolean(viewer.like);
  let likeRecordUri = viewer.like || null;
  let likeCount = post.likeCount ?? 0;
  const likeButton = createButton('favorite', likeCount);
  const updateLikeButton = () => {
    likeButton.innerHTML = `<md-icon class="favorite-icon${liked ? ' is-filled' : ''}" slot="icon">favorite</md-icon>${likeCount > 0 ? `<span class="action-count">${likeCount >= 1000 ? `${(likeCount / 1000).toFixed(1)}K` : likeCount}</span>` : ''}`;
  };
  updateLikeButton();
  likeButton.addEventListener('click', async () => {
    likeButton.disabled = true;
    try {
      if (liked) {
        await client.unlike(likeRecordUri);
        liked = false;
        likeRecordUri = null;
        likeCount = Math.max(0, likeCount - 1);
        showSuccess('post.likeRemoved');
      } else {
        const result = await client.like(post.uri, post.cid);
        liked = true;
        likeRecordUri = result?.data?.uri || null;
        likeCount += 1;
        showSuccess('post.liked');
      }
      updateLikeButton();
    } catch (e) {
      showError('errors.likeFailed');
    } finally {
      likeButton.disabled = false;
    }
  });

  actionRow.append(replyButton, likeButton);
  supporting.appendChild(actionRow);
}

/**
 * 通知リストの描画（差分更新対応）
 * 既存の DOM 要素を可能な限り再利用し、ちらつきを防止
 */
function renderNotifications(notifications) {
  const container = document.getElementById('notifications');
  if (!container) return;
  
  // 既存の通知アイテムを URI でマップ
  const existingItems = new Map();
  Array.from(container.querySelectorAll('md-list-item[data-notification-uri]')).forEach(item => {
    existingItems.set(item.dataset.notificationUri, item);
  });
  
  const usedUris = new Set();
  
  // 空の場合の処理
  if (notifications.length === 0) {
    container.innerHTML = '';
    const emptyItem = document.createElement('md-list-item');
    emptyItem.innerHTML = `<div slot="headline">${t('notification.emptyHeadline')}</div><div slot="supporting-text">${t('notification.empty')}</div>`;
    container.appendChild(emptyItem);
    return;
  }
  
  // 各通知を処理
  notifications.forEach((notification, index) => {
    const uri = notification.uri || '';
    usedUris.add(uri);
    
    let listItem = existingItems.get(uri);
    let divider = null;
    
    // 既存要素がない場合は新規作成
    if (!listItem) {
      listItem = document.createElement('md-list-item');
      listItem.dataset.notificationUri = uri;
      
      const icon = document.createElement('md-icon');
      icon.slot = 'start';
      listItem.appendChild(icon);
      
      const headline = createAuthorLine(notification.author, 'notification.sourceFallback');
      headline.slot = 'headline';
      listItem.appendChild(headline);
      
      const supporting = document.createElement('div');
      supporting.slot = 'supporting-text';
      supporting.className = 'md-typescale-body-medium';
      listItem.appendChild(supporting);
      
      divider = document.createElement('md-divider');
      
      container.appendChild(listItem);
      container.appendChild(divider);
    } else {
      // 既存の divider を取得
      divider = listItem.nextElementSibling;
      if (!divider || divider.tagName !== 'MD-DIVIDER') {
        divider = document.createElement('md-divider');
        listItem.after(divider);
      }
    }
    
    // コンテンツを更新（既存要素を再利用）
    const icon = listItem.querySelector('md-icon[slot="start"]');
    if (icon) {
      icon.textContent = notification.isRead ? 'notifications' : 'notifications_active';
    }
    
    const headline = listItem.querySelector('[slot="headline"]');
    if (headline) {
      headline.innerHTML = '';
      const authorLine = createAuthorLine(notification.author, 'notification.sourceFallback');
      headline.appendChild(authorLine);
    }
    
    const supporting = listItem.querySelector('[slot="supporting-text"]');
    if (supporting) {
      supporting.innerHTML = '';
      
      const reason = document.createElement('div');
      reason.textContent = getNotificationReasonLabel(notification.reason);
      supporting.appendChild(reason);
      
      const text = notification.record?.text;
      if (text) {
        const body = document.createElement('div');
        body.style.whiteSpace = 'pre-wrap';
        body.style.marginTop = '6px';
        body.textContent = text;
        supporting.appendChild(body);
      }
      
      appendNotificationActions(supporting, notification);
      
      if (notification.indexedAt) {
        const time = document.createElement('div');
        time.className = 'md-typescale-body-small';
        time.style.marginTop = '6px';
        time.textContent = formatRelativeTime(new Date(notification.indexedAt));
        supporting.appendChild(time);
      }
    }
  });
  
  // 不要になった既存要素を削除（逆順で削除してインデックスズレを防止）
  const itemsToRemove = [];
  existingItems.forEach((item, uri) => {
    if (!usedUris.has(uri)) {
      itemsToRemove.push(item);
    }
  });
  
  itemsToRemove.forEach(item => {
    const divider = item.nextElementSibling;
    if (divider && divider.tagName === 'MD-DIVIDER') {
      divider.remove();
    }
    item.remove();
  });
  
  // 空メッセージの整理
  const emptyMessage = container.querySelector('md-list-item:not([data-notification-uri])');
  if (emptyMessage && notifications.length > 0) {
    emptyMessage.remove();
  }
}

async function loadNotifications() {
  if (notificationsLoading) return;
  notificationsLoading = true;
  showLoading(true);
  try {
    const notifications = await client.notifications();
    // Fetch both the reply record (for reply notifications) and the parent post (for context)
    const postUris = [...new Set(notifications.flatMap((notification) => {
      const uris = [];
      // For reply notifications, fetch the reply record itself
      if (notification.record?.$type === 'app.bsky.feed.post' && notification.uri) {
        uris.push(notification.uri);
      }
      // Also fetch the parent post (subjectUri) for context display
      if (notification.subjectUri) {
        uris.push(notification.subjectUri);
      } else if (notification.record?.$type === 'app.bsky.feed.post' && notification.uri) {
        // For non-reply notifications, the uri is already the target post
        uris.push(notification.uri);
      }
      return uris;
    }))];
    const posts = await client.posts(postUris);
    const postsByUri = new Map(posts.map((post) => [post.uri, post]));
    notifications.forEach((notification) => {
      // For reply notifications, notification.post is the parent post (context)
      // For other notifications, notification.post is the target post
      const postUri = notification.subjectUri || notification.uri;
      notification.post = postsByUri.get(postUri) || null;
    });
    renderNotifications(notifications);
    updateNotificationBadge(notifications);
  } catch (e) {
    console.error('Notifications load error:', e);
    showError('errors.fetchFailed');
  } finally {
    showLoading(false);
    notificationsLoading = false;
  }
}

function updateNotificationBadge(notifications) {
  const notificationsNav = document.querySelector('[data-nav-item="notifications"]');
  if (!notificationsNav) return;

  // 既存バッジを削除
  const existingBadge = notificationsNav.querySelector('.notification-badge');
  if (existingBadge) existingBadge.remove();

  const unreadCount = notifications.filter(n => !n.isRead).length;
  if (unreadCount === 0) return;

  const badge = document.createElement('span');
  badge.className = 'notification-badge';
  badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  notificationsNav.appendChild(badge);
}

function updateSeeMoreButton(loadingMore) {
  if (!timelineBottom || !seeMoreBtn) return;
  timelineBottom.style.display = timelineHasMore ? 'flex' : 'none';
  seeMoreBtn.disabled = loadingMore || !timelineHasMore;
  seeMoreBtn.innerHTML = loadingMore
    ? '<md-icon slot="icon">hourglass_empty</md-icon>読み込み中...'
    : '<md-icon slot="icon">expand_more</md-icon>See more';
}

// エンターキーで投稿（Ctrl+Enter または Cmd+Enter）
const postTextarea = document.querySelector('#postText textarea[slot="textarea"]');
if (postTextarea) {
  postTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!postBtn.disabled) {
        postBtn.click();
      }
    }
  });
}
