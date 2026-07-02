# Apifox Failure Probes

Use these only when the Apifox JSON does not include response bodies.

## Prerequisites

Run a fresh go-only suite first so `groupChannelId` and `postId` are known from Apifox runtime variables or copied from `apifox-run.log`.

## Probe Template

```bash
GROUP_CHANNEL_ID="$(
  curl -sS 'http://127.0.0.1:8066/api/cses/channel/create' \
    -H 'content-type: application/json' \
    -H 'cookieId: 444' \
    -H 'companyId: 64118eebd2b665246b7880eb' \
    --data '{"teamId":"64118eebd2b665246b7880eb","displayName":"loopforge-probe-group","orient":"","type":"P","users":[{"id":"444","teamId":"64118eebd2b665246b7880eb","role":"CREATOR"},{"id":"678","teamId":"64118eebd2b665246b7880eb","role":"MEMBER"}],"picturetype":"USER","picture":{"userIds":["444","678"]},"forceCreate":true}' \
  | node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{const r=JSON.parse(s); console.log(r.data?.id || r.data?.channelId || r.data);});'
)"
curl -sS -i 'http://127.0.0.1:8066/api/cses/posts/createSchedule' \
  -H 'content-type: application/json' \
  -H 'cookieId: 444' \
  -H 'companyId: 64118eebd2b665246b7880eb' \
  --data '{"channelId":"'"$GROUP_CHANNEL_ID"'","message":"定时消息测试","type":"TEXT","scheduleTime":1782990000,"userId":"444","teamId":"64118eebd2b665246b7880eb"}'
```

```bash
curl -sS -i 'http://127.0.0.1:8066/api/cses/channel/member/snapshot' \
  -H 'content-type: application/json' \
  -H 'cookieId: 678' \
  -H 'companyId: 64118eebd2b665246b7880eb' \
  --data '{"channelId":"'"$GROUP_CHANNEL_ID"'","page":0,"pageSize":50}'
```
