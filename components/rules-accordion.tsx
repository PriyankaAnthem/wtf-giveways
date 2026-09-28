import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

interface RulesAccordionProps {
  rulesText: string
}

export function RulesAccordion({ rulesText }: RulesAccordionProps) {
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="rules">
        <AccordionTrigger className="text-left text-base font-semibold">Rules & Eligibility</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 pt-2 text-sm leading-relaxed text-muted-foreground">
            <p>{rulesText}</p>
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs">
                <strong>Important:</strong> By entering this giveaway, you agree to our Terms of Service and Privacy
                Policy. See our{" "}
                <a href="/terms" className="underline hover:text-foreground">
                  full terms
                </a>{" "}
                for complete details.
              </p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
