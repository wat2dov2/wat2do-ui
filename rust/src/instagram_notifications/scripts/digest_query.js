(() => {
  const requestKey = @@REQUEST_KEY@@;
  const request = {controller: new AbortController(), settled: false,
    result: {state: "pending"}};
  window[requestKey] = request;
  (async () => {
    try {
      const csrf = document.cookie.split(";").map(value => value.trim())
        .find(value => value.startsWith("csrftoken="))?.slice("csrftoken=".length);
      if (!csrf) {
        request.result = {state: "failed", reason: "auth_required"};
        return;
      }
      const mediaIds = [];
      const seenMedia = new Set();
      const seenCursors = new Set();
      let maxId = null;
      for (let pageCount = 1; pageCount <= @@MAXIMUM_PAGES@@; pageCount += 1) {
        if ((@@RECIPIENT_IS_ACTIVE@@) !== "true" ||
            request.controller.signal.aborted) {
          request.result = {state: "failed", reason: "account_changed"};
          return;
        }
        const variables = {
          request: {cache_ent_id: @@CACHE_ENT_ID@@, max_id: maxId},
          enable_audience_in_light_media: false,
          enable_clips_metadata_in_light_media: false,
          enable_likers_in_full_media: false,
          enable_thumbnails_in_light_media: false,
          enable_video_versions_in_light_media: false,
          exclude_caption_user_field: false,
          exclude_main_user_field: false,
          include_attribution_ui_data: false
        };
        const body = new URLSearchParams({
          signed_body: "SIGNATURE.",
          vc_policy: "default",
          locale: "en_US",
          client_doc_id: @@CLIENT_DOC_ID@@,
          variables: JSON.stringify(variables),
          strip_nulls: "true",
          strip_defaults: "true"
        });
        const response = await fetch(@@ENDPOINT_URL@@, {
          method: "POST",
          credentials: "include",
          signal: request.controller.signal,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-csrftoken": csrf,
            "x-ig-app-id": @@WEB_APP_ID@@,
            "x-requested-with": "XMLHttpRequest",
            "x-client-doc-id": @@CLIENT_DOC_ID@@,
            "x-fb-friendly-name": @@OPERATION_NAME@@,
            "x-ig-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
            "x-graphql-client-library": "minimal"
          },
          body: body.toString()
        });
        if (response.status === 401 || response.status === 403) {
          request.result = {state: "failed", reason: "auth_required"};
          return;
        }
        if (response.status === 429) {
          request.result = {state: "failed", reason: "rate_limited"};
          return;
        }
        if (response.status >= 500) {
          request.result = {state: "failed", reason: "temporarily_unavailable"};
          return;
        }
        if (!response.ok) {
          request.result = {state: "failed", reason: "query_rejected"};
          return;
        }
        const payload = await response.json();
        if ((@@RECIPIENT_IS_ACTIVE@@) !== "true") {
          request.result = {state: "failed", reason: "account_changed"};
          return;
        }
        const feed = payload?.data?.subscription_digest_feed;
        if (!feed || !Array.isArray(feed.items) || typeof feed.paging_info !== "object") {
          request.result = {state: "failed", reason: "invalid_response"};
          return;
        }
        for (const item of feed.items) {
          const media = item?.media;
          // Instagram nulls a post it could not load (deleted or restricted)
          // and reports an execution error; the rest of the page is still good.
          if (media === null || media === undefined) continue;
          let candidates = [media?.pk, media?.id]
            .filter(value => value !== undefined && value !== null)
            .map(value => String(value).split("_", 1)[0]);
          // A partly loaded post keeps only its "<media>_<owner>" strong ID.
          if (!candidates.length && typeof media.strong_id__ === "string") {
            candidates = [media.strong_id__.split("_", 1)[0]];
          }
          if (!candidates.length) continue;
          if (!candidates.length || candidates.some(value => value !== candidates[0]) ||
              !/^[1-9][0-9]{0,31}$/.test(candidates[0])) {
            request.result = {state: "failed", reason: "invalid_response"};
            return;
          }
          if (!seenMedia.has(candidates[0])) {
            seenMedia.add(candidates[0]);
            mediaIds.push(candidates[0]);
          }
        }
        if (feed.paging_info.more_available !== true) {
          request.result = {
            state: "succeeded",
            media_ids: mediaIds,
            page_count: pageCount
          };
          return;
        }
        const nextCursor = feed.paging_info.max_id;
        if (typeof nextCursor !== "string" || !nextCursor || seenCursors.has(nextCursor)) {
          request.result = {state: "failed", reason: "invalid_response"};
          return;
        }
        seenCursors.add(nextCursor);
        maxId = nextCursor;
      }
      request.result = {state: "failed", reason: "page_limit"};
    } catch (_error) {
      request.result = {state: "failed", reason: "request_failed"};
    } finally {
      request.settled = true;
    }
  })();
  return "started";
})()