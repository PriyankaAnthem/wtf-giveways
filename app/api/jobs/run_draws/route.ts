import { NextRequest } from "next/server"
import { GET as runDrawsGET } from "@/app/api/jobs/run-draws/route"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
  return runDrawsGET(request)
}
