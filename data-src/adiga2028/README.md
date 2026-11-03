# 2028 권장과목

원본은 대교협 「2028 모집단위별 반영과목 및 대학별 권장과목 자료집」(PDF 2025-12-18)이다. 고친 뒤 `node scripts/build-adiga.mjs`로 검사하고 `src/data/adiga2028.json`을 다시 만든다.

원문 글자는 그대로 두고 해석은 보수적으로 한다. 확실하지 않으면 그 학과에 `"unsure": "이유"`를 붙인다.

## 모양

권역별 파일(`seoul-a.json` 등)은 대학 배열이다.

```json
{
  "id": "catholic",
  "name": "가톨릭대학교",
  "short": "가톨릭대",
  "region": "서울",
  "pages": [25, 26],
  "general": "",
  "units": [
    {
      "name": "물리학과",
      "core": "물리학, 수학(과목 위계를 고려하여 3과목 이상)",
      "recommended": "",
      "merged": true,
      "note": "물리학 과목 1과목 이상",
      "clauses": [
        { "level": "recommended", "pick": 1, "subjects": ["family:물리"], "text": "물리학 과목 1과목 이상" },
        { "level": "recommended", "pick": 3, "subjects": ["area:수학"], "text": "수학(과목 위계를 고려하여 3과목 이상)" }
      ],
      "majors": ["physics"]
    }
  ]
}
```

- `pages`: 자료집에 인쇄된 쪽 번호. `general`: 대학 공통 안내 문장.
- 한 칸에 학과가 여럿이면 학과마다 따로 적는다.
- `core`·`recommended`·`note`: 칸 글자 그대로. 핵심·권장 칸이 합쳐져 있으면 `core`에 넣고 `merged: true`.
- `majors`: `src/data/majors.ts`의 계열 id. 교육 계열은 과목 계열도 함께 적는다 (수학교육과 → `["edu", "math"]`).

## clauses

- `level`: 핵심과목 칸은 `core`, 권장과목 칸과 합쳐진 칸은 `recommended`.
- `pick`: `"all"` 또는 n (이 중 n과목 이상).
- `subjects`: `src/data/subjects.ts`의 2022 개정 과목명, 또는 묶음 표기.
  - `area:<교과>`: 그 교과 과목 전체 (수학, 과학, 정보, 국어, 영어, 사회, 제2외국어, 한문, 예술, 체육, 기술·가정)
  - `general:과학`: 과학 일반선택 4과목. `career:과학`: 과학 진로선택 8과목. `career:수학`: 수학 진로선택
  - `family:물리`, `family:화학`, `family:생명`, `family:지구`: 같은 계열 과목 (예: 물리학·역학과 에너지·전자기와 양자)
- 예: "미적분Ⅱ 또는 기하" → `{ "pick": 1, "subjects": ["미적분Ⅱ", "기하"] }`
- 2015 개정 과목명(물리학Ⅰ 등)은 넣지 않고 `note`에 남긴 뒤 `"legacy": true`를 붙인다.
- 과목을 정하지 않았으면 `clauses: []`.

## 다른 파일

- `univ-official.json`: 자료집에 없고 입학처 공식 자료가 있는 대학. 같은 모양에 `source: { title, url, date }`를 붙인다. 핵심·권장 구분이 없으면 모두 `recommended`, 권장과목이 없다고 밝힌 학과는 `clauses: []`.
- `univ-research-2026-10.json`: 2026-10-23에 확인한 135개 대학. 학과별 자료가 없으면 `units: []`에 `policy`(자료 성격)만 둔다. `caveat`는 화면에 함께 보일 주의 문장.
- 세부 학과는 학과 이름으로 정해진다 (`majors.ts`의 `FINE_MAJORS`). 여러 학과를 묶을 때는 세부 학과 낱말이 없는 이름(예: `그 밖의 모집단위`)을 쓴다.
