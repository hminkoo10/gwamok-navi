# 과목내비

희망 학과와 대학을 고르면 우리 학교 편제표에서 들을 선택과목을 짜 주는 웹앱. 대학별 2028학년도 권장과목과 전형을 함께 보여 준다.

https://navi.milky.kr

## 실행

Node 24 이상.

```bash
npm install
cp .env.example .env   # 값 설명은 파일 안에 있다
npm run dev
npm test
```

운영은 `npm run build` 후 `npm start`.

## 자료

- 권장과목: 대교협 「2028 모집단위별 반영과목 및 대학별 권장과목 자료집」과 대학 공식 자료 (`data-src/adiga2028`)
- 전형: 대학별 「2028학년도 대학입학전형시행계획」 (`data-src/admissions2028`)
