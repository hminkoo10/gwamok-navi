import type { School } from '../schema'
import { BANSONG_2026 } from './bansong2026'

export const SCHOOLS: School[] = [BANSONG_2026]

export const SCHOOL_BY_ID = new Map(SCHOOLS.map((s) => [s.id, s]))
