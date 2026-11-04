(() => {
  const fail = reason => ({status: "failed", reason});
  const expected = new URL(@@POST_URL@@);
  if (window.location.origin !== expected.origin ||
      window.location.pathname.replace(/\/$/, "") !== expected.pathname.replace(/\/$/, "")) {
    return fail("wrong_post");
  }
  if (document.readyState !== "complete") return fail("not_ready");
  const visible = element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none" &&
      !element.closest('[aria-hidden="true"]');
  };
  const labels = element => [...element.querySelectorAll("[aria-label]")]
    .concat(element.matches("[aria-label]") ? [element] : [])
    .filter(visible).map(node => node.getAttribute("aria-label"));
  const isToolbar = section => {
    const names = labels(section);
    return names.includes("Comment") && names.some(name => ["Like", "Unlike"].includes(name));
  };
  const shortcode = href => {
    try {
      const url = new URL(href, expected.origin);
      if (url.origin !== expected.origin) return null;
      return url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/)?.[1] || null;
    } catch (_error) {
      return null;
    }
  };
  const expectedCode = shortcode(expected.href);
  const toolbars = [...document.querySelectorAll("section")].filter(isToolbar)
    .filter(section => ![...section.querySelectorAll("section")].some(isToolbar));
  const candidates = toolbars.map(toolbar => {
    let post = toolbar.parentElement;
    while (post && post !== document.body) {
      // A sibling post cannot lend its permalink to this toolbar, even through
      // an otherwise unmarked page wrapper.
      if ([...post.querySelectorAll('article,main,[role="main"]')]
          .filter(visible).some(container => !container.contains(toolbar))) return null;
      const links = [...post.querySelectorAll("a[href]")].filter(visible)
        .map(anchor => ({anchor, code: shortcode(anchor.getAttribute("href"))}))
        .filter(link => link.code);
      // A standalone MAIN may own its direct toolbar and direct timestamp.
      // Do not borrow a timestamp from another branch of the whole page.
      if (post.matches('main,[role="main"]') &&
          (toolbar.parentElement !== post ||
           links.some(link => link.anchor.parentElement !== post))) return null;
      const codes = links.map(link => link.code);
      if (codes.length) {
        return codes.every(code => code === expectedCode) ? {post, toolbar} : null;
      }
      // Do not search outside this post/article or across the whole feed.
      if (post.matches('article,main,[role="main"]')) return null;
      post = post.parentElement;
    }
    return null;
  }).filter(Boolean);
  if (candidates.length !== 1) return fail("ambiguous_post");
  const {post, toolbar} = candidates[0];
  if ([...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => visible(dialog) && !dialog.contains(post))) return fail("blocked");
  return {status: "ready", post, toolbar, visible, labels};
})()