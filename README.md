# 한우도감 재고장부 (독립 웹사이트)

- 화면: `index.html` (폰·태블릿·PC 자동 배치)
- 데이터: `api/data.js` → Vercel Blob(비공개) `hanwoo/db.json`, 날짜별 백업 `hanwoo/backup/YYYY-MM-DD.json`
- 사진 글자 읽기: `api/read-label.js` (환경변수 `ANTHROPIC_API_KEY`가 있을 때만 켜짐)

## Vercel 환경변수
| 이름 | 설명 |
|---|---|
| `STORE_PIN` | 가게 비밀번호(로그인) |
| `BLOB_READ_WRITE_TOKEN` | Blob 저장소 연결 시 자동 생성 |
| `ANTHROPIC_API_KEY` | (선택) 사진으로 입고 기능 |
