// 학교에 없는 과목을 들을 수 있는 곳: 시도교육청 온라인학교와 공동교육과정 안내 페이지.
// 2026-10-20에 주소마다 직접 열어 확인했다. 수강 신청은 대부분 다니는 학교를 거쳐서 한다.
// 교실온닷(classon.kr)은 도메인이 광고 페이지로 넘어가서 넣지 않았다. 전남온라인학교는 접속이 안 돼 뺐다.

export interface JointLink {
  name: string
  url: string
}

export const JOINT_CHECKED = '2026-10-20'

/** 고교학점제 공식 홈페이지(한국교육과정평가원)의 안내와 시도별 목록 */
export const JOINT_NATIONAL = {
  joint: { name: '고교학점제 홈페이지: 공동교육과정', url: 'https://www.hscredit.kr/coCurr/intro' },
  online: { name: '고교학점제 홈페이지: 온라인학교', url: 'https://www.hscredit.kr/online/intro' },
} satisfies Record<string, JointLink>

export const JOINT_BY_SIDO: Record<string, { online?: JointLink; joint?: JointLink }> = {
  서울: {
    online: { name: '서울온라인학교', url: 'https://seoulonline.sen.hs.kr/' },
    joint: { name: '서울 학교 간 공동교육과정', url: 'https://seoulhsc.sen.go.kr/fus/MI000000000000000140/html/cont0010v.do' },
  },
  부산: {
    online: { name: '부산온라인학교', url: 'https://school.busanedu.net/busanonline-h/' },
    joint: { name: '부산 학교연합형교육과정', url: 'https://co-school.pen.go.kr/comEdu/main/index.do' },
  },
  대구: {
    online: { name: '대구온라인학교', url: 'https://online.dge.sc.kr/' },
    joint: { name: '대구 공동교육과정', url: 'https://www.dge.go.kr/gongdong/' },
  },
  인천: {
    online: { name: '인천온라인학교', url: 'https://iconline.icehs.kr/' },
    joint: { name: '인천 꿈두레 공동교육과정', url: 'https://www.ice.go.kr/hakjeom/cm/cntnts/cntntsView.do?mi=12760&cntntsId=1222' },
  },
  광주: {
    online: { name: '빛고을온학교', url: 'https://onschool.jge.hs.kr/' },
    joint: { name: '광주 공동교육과정', url: 'https://cic.jge.go.kr/high/sub/page.php?page_code=education_01' },
  },
  대전: {
    online: { name: '대전온라인학교', url: 'https://djonline.djsch.kr/' },
    joint: { name: '대전 너두나두 공동교육과정', url: 'https://djehcredit.com/hscredit/credit/curriculum.php' },
  },
  울산: {
    online: { name: '울산온라인학교', url: 'https://school.use.go.kr/usonline' },
    joint: { name: '울산 배나무 공동교육과정', url: 'https://use.go.kr/uscredit/process/prcInfo.jsp' },
  },
  세종: {
    online: { name: '온세종학교', url: 'https://on.sc.kr/index.do' },
    joint: { name: '세종 캠퍼스형 공동교육과정', url: 'https://www.sje.go.kr/free/cm/cntnts/cntntsView.do?mi=52452&cntntsId=35623' },
  },
  경기: {
    online: { name: '경기이음온학교', url: 'https://gg-ieumon.goesw.kr/' },
    joint: { name: '경기 공동교육과정', url: 'https://more.goe.go.kr/hagjeomje/subList/30300001175' },
  },
  강원: {
    online: { name: '강원온라인학교', url: 'https://gwonline.gwe.hs.kr/' },
    joint: { name: '강원 공동교육과정', url: 'https://hscredit.gwe.go.kr/fam/fam_gw.do' },
  },
  충북: {
    online: { name: '충북온라인학교', url: 'https://school.cbe.go.kr/cbonline-h' },
    joint: { name: '충북 공동교육과정', url: 'https://hscredit.cbe.go.kr/home/sub.php?menukey=6453' },
  },
  충남: {
    online: { name: '충남온라인학교', url: 'https://onmadang.or.kr/safety/onlineschool.html' },
    joint: { name: '충남 참학력 공동교육과정', url: 'https://onmadang.or.kr/safety/jointcurricula.html' },
  },
  전북: {
    online: { name: '전북온라인학교', url: 'https://school.jbedu.kr/jbon' },
    joint: { name: '전북 공동교육과정', url: 'https://jbecredit.kr/lecture/' },
  },
  전남: {
    joint: { name: '전남광주 고교학점제 지원센터', url: 'https://cic.jge.go.kr/high/main/main.php' },
  },
  경북: {
    online: { name: '경북온라인학교', url: 'https://school.gyo6.net/gbonline/' },
    joint: { name: '경북 공동교육과정', url: 'https://school.gyo6.net/coschool/main.do' },
  },
  경남: {
    online: { name: '경남온라인학교', url: 'https://gneonline-h.gne.go.kr/' },
    joint: { name: '경남 공동교육과정', url: 'https://www.gne.go.kr/h-creditsystem/education/introduction/introduction_01.jsp' },
  },
  제주: {
    online: { name: '제주온라인학교', url: 'https://school.jje.go.kr/jejuon/' },
    joint: { name: '제주 공동교육과정', url: 'https://jhscs.jje.go.kr/commcurr/guide.do' },
  },
}

/** 학교 소재지(시도)의 온라인학교·공동교육과정 링크. 시도를 모르면 전국 안내 */
export function jointLinksFor(sido: string): JointLink[] {
  const local = JOINT_BY_SIDO[sido]
  const list = [local?.online, local?.joint].filter((x): x is JointLink => !!x)
  return list.length ? list : [JOINT_NATIONAL.online, JOINT_NATIONAL.joint]
}
