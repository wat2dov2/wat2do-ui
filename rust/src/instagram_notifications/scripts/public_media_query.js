(() => {
 const key = @@REQUEST_KEY@@;
 const request = {controller: new AbortController(), settled: false, result: {state: "pending"}};
 window[key] = request;
 (async () => {
  let reason = "request_failed";
  let httpStatus = null;
  try {
   reason = "account_changed";
   if ((@@CURRENT_ACCOUNT_USERNAME@@) !== @@USERNAME@@) throw new Error();
   reason = "request_failed";
   const response = await fetch(@@ENDPOINT@@, {credentials: "include",
     signal: request.controller.signal,
     headers: {"x-ig-app-id": @@WEB_APP_ID@@}});
   if (!response.ok) {
    reason = "http_error";
    if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) httpStatus = response.status;
    throw new Error();
   }
   reason = "invalid_json";
   const body = await response.json();
   reason = "account_changed";
   if ((@@CURRENT_ACCOUNT_USERNAME@@) !== @@USERNAME@@) throw new Error();
   const image = media => {
     const candidates = media.image_versions2?.candidates || [];
     const best = [...candidates].sort((a,b) => b.width*b.height-a.width*a.height)[0];
     const videos = [...(media.video_versions || [])].sort((a,b) => b.width*b.height-a.width*a.height);
     return {type: media.media_type === 2 || media.is_video ? "Video" : "Image", displayUrl: best?.url || media.display_url, videoUrl: videos[0]?.url || media.video_url || null};
   };
   const project = media => {
     const children = media.carousel_media || media.edge_sidecar_to_children?.edges?.map(e => e.node) || [];
     const coauthors = media.coauthor_producers || media.coauthors || [];
     return {url: `https://www.instagram.com/p/${media.code || media.shortcode}/`,
       ownerUsername: media.user?.username || media.owner?.username || @@PROFILE_OWNER@@,
       timestamp: new Date((media.taken_at || media.taken_at_timestamp)*1000).toISOString(),
       caption: media.caption?.text || media.edge_media_to_caption?.edges?.[0]?.node?.text || "",
       ...image(media),
       type: children.length || media.media_type === 8 || media.__typename === "GraphSidecar" ? "Sidecar" : (media.media_type === 2 || media.is_video ? "Video" : "Image"),
       childPosts: children.map(image),
       coauthors: coauthors.map(u => ({username:u.username})),
       taggedUsers: (media.usertags?.in || []).map(t => ({username:t.user?.username}))};
   };
   reason = "invalid_media";
   const media = @@MEDIA_LIST@@;
   if (!Array.isArray(media)) throw new Error();
   reason = "projection_failed";
   request.result = {state: "succeeded", posts: media.slice(0,@@POST_LIMIT@@).map(project)};
  } catch (_error) {request.result = {state: "failed", reason, ...(httpStatus === null ? {} : {http_status: httpStatus})};}
  finally {request.settled = true;}
 })();
 return "started";
})()