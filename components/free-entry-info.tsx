"use client"

import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Mail } from "lucide-react"

export function FreeEntryInfo() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="mt-3 text-sm font-medium text-purple-200 underline underline-offset-2 transition-colors hover:text-purple-100"
        >
          Free postal entry available
        </button>
      </DialogTrigger>
      <DialogContent className="border-purple-500/30 bg-[#160a26] text-white sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-purple-900/50">
            <Mail className="h-6 w-6 text-purple-300" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center text-xl text-white">
            Free Postal Entry
          </DialogTitle>
          <DialogDescription className="text-center text-purple-200">
            You may enter the competition for free by complying with the following conditions.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-4 text-sm text-purple-100 pr-1">
          <ol className="list-decimal list-outside space-y-3 pl-4">
            <li className="leading-relaxed">
              Send your entry by first or second class post to the Promoter at the following address:
              <address className="not-italic rounded-lg border border-purple-500/20 bg-purple-900/30 p-3 mt-2 text-center leading-relaxed">
                16 Green Drive
                <br />
                Thornton-Cleveleys
                <br />
                United Kingdom
                <br />
                FY5 1LQ
              </address>
            </li>

            <li className="leading-relaxed">
              Hand delivered entries will not be accepted and will not be entered into the random draw.
            </li>

            <li className="leading-relaxed">
              Include with your entry the following information. All details must match the details on your account:
              <ul className="list-disc list-inside mt-2 space-y-1 text-purple-200">
                <li>The name or details of the competition you wish to enter</li>
                <li>Your full name</li>
                <li>Your address</li>
                <li>A contact telephone number and email address</li>
                <li>Your answer to the Competition Question, if there is one</li>
              </ul>
            </li>

            <li className="leading-relaxed">
              Incomplete or illegible entries will be disqualified.
            </li>

            <li className="leading-relaxed">
              You may make multiple free entries for any competition, up to any limit placed on entries by the Promoter, but each free entry must be submitted and posted to the Promoter separately. Bulk entries in one envelope will not be accepted as multiple entries and, if a bulk entry is received, it will be counted as one single entry.
            </li>

            <li className="leading-relaxed">
              By entering the competition, you are confirming that you are eligible to enter and accept these terms and conditions.
            </li>

            <li className="leading-relaxed">
              Your entry must be received by the Promoter prior to the Closing Date. Entries received after the Closing Date will not be entered into the random draw. Proof of posting does not guarantee that you will be entered into the random draw.
            </li>

            <li className="leading-relaxed">
              The Promoter will not acknowledge receipt of your entry nor confirm if your answer to the Competition Question is correct.
            </li>

            <li className="leading-relaxed">
              If the number of entries received reaches any cap or limit before your free entry is received, you will not be entered into the random draw.
            </li>
          </ol>

          <p className="text-xs text-purple-300 pt-2 border-t border-purple-500/20">
            Your entry is subject to our full terms and conditions.{" "}
            <Link
              href="/terms"
              className="text-amber-400 underline underline-offset-2 hover:text-amber-300"
            >
              Click here for details
            </Link>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
