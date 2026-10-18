# 차량 예약 조회

카메라로 번호판을 비추면 자동으로 차량번호를 읽고, 바로 아래에 **예약 여부를 신호등**으로 보여주는 확인 페이지입니다.
예약 데이터는 **예약일자 · 예약시간대 · 차량번호**로 DB에 저장되어 있고, 이 페이지는 **조회만** 합니다(예약 등록은 하지 않음).

예약 시간대: **09:00~12:00 / 12:00~15:00 / 15:00~18:00**

- 화면: HTML/CSS/JavaScript (빌드 없음, GitHub Pages로 바로 공개)
- DB: [Supabase](https://supabase.com) (무료 PostgreSQL)
- 번호판 인식: [Tesseract.js](https://tesseract.projectnaptha.com/) 한국어 OCR (브라우저 안에서 처리, 사진이 외부로 전송되지 않음)

## 화면 동작

1. **카메라 켜기** → 번호판을 가운데 네모 안에 맞춥니다.
2. 같은 번호가 연속으로 읽히면 확정하고, 영상 바로 아래에 신호가 뜹니다. (현재 시각 기준)
   - 🟢 **초록불 · 입차 가능**: 오늘 예약이고 지금이 예약 시간대
   - 🟡 **노란불**: 오늘 예약이지만 지금은 예약 시간대가 아님 (몇 시간 후 시작 / 종료됨 표시)
   - 🔴 **빨간불**: 오늘 예약이 아님 (다른 날짜 예약이면 그 날짜 표시, 예약이 없으면 뒷번호가 비슷한 오늘 예약 안내)
3. 카메라는 켜진 채로 계속 인식하므로 다음 차량도 바로 확인됩니다.
4. 인식이 틀리면 번호 칸을 직접 고쳐 **예약 확인**을 누르면 됩니다.
5. 아래 **예약 현황**에서 날짜·시간대별 예약과 오늘 시간대 상태(진행 중 / 대기 / 종료)를 볼 수 있습니다. 1분마다 자동으로 새로 불러옵니다.

## 예약 데이터 넣기

확인 페이지에는 등록 기능이 없습니다. Supabase 대시보드 **Table Editor → reservations → Insert row**에서 넣거나, 다른 예약 시스템이 이 테이블에 직접 저장하게 하세요.

| reserve_time 값 | 시간대 |
|---|---|
| `09:00` | 09:00~12:00 |
| `12:00` | 12:00~15:00 |
| `15:00` | 15:00~18:00 |

`plate_key`는 공백 없이(`12가3456`), `plate`는 보기 좋게(`12가 3456`) 넣습니다.

## 설정 순서

### 1. Supabase에 DB 만들기
1. https://supabase.com 가입 → **New project** 생성
2. 왼쪽 메뉴 **SQL Editor** → `supabase.sql` 내용을 붙여넣고 **Run**
   (예약 테이블, 조회 전용 권한, 예시 데이터 3건이 만들어집니다)
3. **Project Settings → API** 에서 `Project URL`과 `anon public` 키를 복사

### 2. config.js 수정
```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcdxyz.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
};
```
> `anon` 키는 공개돼도 되는 키입니다. `service_role` 키는 절대 넣지 마세요.

### 3. GitHub에 올리기
1. GitHub에서 새 저장소 생성 (예: `plate-reservation`)
2. 이 폴더의 파일을 모두 올립니다 (웹에서 **Add file → Upload files**로 끌어다 놓아도 됩니다)
   ```bash
   git init
   git add .
   git commit -m "차량 예약 조회 페이지"
   git branch -M main
   git remote add origin https://github.com/<아이디>/plate-reservation.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages** → Source를 `main` 브랜치 `/ (root)`로 저장
4. 1~2분 뒤 `https://<아이디>.github.io/plate-reservation/` 에서 열립니다.

> 카메라는 **https 주소**에서만 켜집니다. GitHub Pages는 https라 그대로 동작합니다.
> 내 컴퓨터에서 시험할 땐 파일을 더블클릭하지 말고 `python3 -m http.server` 실행 후 `http://localhost:8000` 으로 여세요.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 구조 |
| `style.css` | 디자인 (라이트/다크 모드) |
| `app.js` | 카메라 인식, 신호등 판정, 예약 현황 |
| `config.js` | Supabase 연결 정보 |
| `supabase.sql` | DB 테이블·권한 생성 스크립트 |

## DB 구조 (`reservations` 테이블)

| 컬럼 | 형식 | 설명 |
|---|---|---|
| `reserve_date` | date | 예약일자 |
| `reserve_time` | time | 예약시간대 시작 시각 (`09:00`/`12:00`/`15:00`만 허용) |
| `plate` | text | 차량번호 (표시용, `12가 3456`) |
| `plate_key` | text | 차량번호 (공백 제거, 검색용, `12가3456`) |

## 알아둘 점

- **인식 정확도**: 무료 OCR이라 밝고 정면에서 찍힌 번호판일수록 잘 읽힙니다. 역광·야간·기울어진 번호판은 틀릴 수 있어 직접 입력을 함께 두었습니다. 정확도가 더 필요하면 전용 번호판 인식 API(예: 네이버 CLOVA OCR, Plate Recognizer)로 `scanFrame` 부분만 교체하면 됩니다.
- **보안**: 페이지 주소를 아는 사람은 누구나 예약을 **조회**할 수 있습니다(등록·삭제는 불가). 차량번호를 외부에 보이고 싶지 않다면 Supabase Auth 로그인을 추가해 조회도 막으세요.
- **시간 기준**: 신호등은 페이지를 연 기기의 현재 시각으로 판정합니다. 확인용 기기의 시계가 한국 시간으로 맞는지 확인하세요.
- 지원 번호 형식: `12가3456`, `123가4567`, `서울12가3456`
