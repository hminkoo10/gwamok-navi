// scripts/build-admissions.mjs가 만드는 admissions2028.json의 모양. JSON을 직접 타입 추론하지 않게 따로 적는다.
import type { AdmissionPlan } from './schema'

declare const data: {
  year: number
  plans: AdmissionPlan[]
}

export default data
