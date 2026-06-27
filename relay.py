"""
hf_relay.py  —  私有 HF Router 泛用中继
用法:
  export HF_TOKEN="hf_你的真实Token"
  export SK_RELAY="sk-relay-你自己设一个强随机串"
  python3 -m uvicorn relay:app --host 0.0.0.0 --port 8400
"""

import os
import httpx
from fastapi import FastAPI, Request, HTTPException, Response

HF_TOKEN = os.environ.get("HF_TOKEN", "")
SK_RELAY = os.environ.get("SK_RELAY", "")

TARGET = "https://router.huggingface.co"

app = FastAPI()


def _check_auth(req: Request):
    """只认我们自己的 SK_RELAY，不对外暴露 HF_TOKEN"""
    h = req.headers.get("authorization", "")
    if not h.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing authorization")
    tok = h.removeprefix("Bearer ").strip()
    if tok != SK_RELAY:
        raise HTTPException(status_code=403, detail="forbidden")


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(req: Request, path: str):
    # CORS / OPTIONS 预检直接放行（方便浏览器调试时顺手兼容）
    if req.method == "OPTIONS":
        return Response(status_code=204, headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
        })

    _check_auth(req)

    # 规范化 path：保证以 v1/ 开头
    p = (path or "").lstrip("/")
    if not p.startswith("v1/"):
        p = "v1/" + p

    url = f"{TARGET}/{p}"

    body = await req.body()

    # 透传 headers（去掉 host/携带长度的，避免冲突；注入我们的 HF auth）
    headers = {
        k: v
        for k, v in req.headers.items()
        if k.lower() not in ("host", "content-length", "transfer-encoding", "connection")
    }
    headers["Authorization"] = f"Bearer {HF_TOKEN}"
    headers["Host"] = "router.huggingface.co"

    async with httpx.AsyncClient(timeout=180.0, follow_redirects=False) as client:
        r = await client.request(
            method=req.method,
            url=url,
            content=body,
            headers=headers,
        )

    return Response(
        content=r.content,
        status_code=r.status_code,
        headers={
            k: v
            for k, v in r.headers.items()
            if k.lower() not in ("transfer-encoding", "connection", "keep-alive")
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("relay:app", host="0.0.0.0", port=8400)