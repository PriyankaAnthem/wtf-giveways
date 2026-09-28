import { SectionHeader } from "@/components/section-header"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import Link from "next/link"

export default function FAQPage() {
  return (
    <div className="container max-w-3xl px-4 py-8">
      <SectionHeader title="Frequently Asked Questions" subtitle="Get answers to common questions" />

      <Accordion type="single" collapsible className="mt-8">
        <AccordionItem value="item-1">
          <AccordionTrigger>How do I enter the competition?</AccordionTrigger>
          <AccordionContent>
            <p>First, ensure you have opened an account on our website. Then choose the competition you wish to enter.</p>
            <p className="mt-2">Enter the competition either by purchasing a ticket online or following the free entry route.</p>
            <p className="mt-2">You will receive an email with the ticket number(s) and if you have won an instant prize.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-2">
          <AccordionTrigger>How will I know if I have won?</AccordionTrigger>
          <AccordionContent>
            <p>We will notify the winner via telephone or email within 7 days of the closing date of the competition. If you change any of your contact details prior to the closing date, you must inform us.</p>
            <p className="mt-2">We will try to contact you using the information you have supplied us with. If we cannot reach you within 14 days of the closing date we reserve the right to choose another winner and you will lose your right to claim the prize.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-3">
          <AccordionTrigger>How long is the competition open for?</AccordionTrigger>
          <AccordionContent>
            <p>The opening and closing date of the competitions are stated on the website. If we have to change either of these dates for any reason, we will update the website accordingly.</p>
            <p className="mt-2">We will only change the dates if we have to for reasons outside of our control.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-4">
          <AccordionTrigger>Can anyone enter the competition?</AccordionTrigger>
          <AccordionContent>
            <p>The competition is open to residents of the United Kingdom only who are 18 years or older.</p>
            <p className="mt-2">We do not accept entries from anyone outside of these areas as the laws for running competitions vary. This competition has been organised to comply with the laws of England and Wales.</p>
            <p className="mt-2">Also, you cannot enter this competition if you are a relative of any of our suppliers.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-5">
          <AccordionTrigger>What are the prizes?</AccordionTrigger>
          <AccordionContent>
            <p>The prizes are described fully on the website. You can find out more details on our <Link href="/giveaways" className="text-amber-400 underline underline-offset-2 hover:text-amber-300">giveaways page</Link>.</p>
            <p className="mt-2">We reserve the right to offer an alternative prize of an equal or higher value if the prize is unavailable for any reason.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-6">
          <AccordionTrigger>Can I sell the prize if I don&apos;t want it?</AccordionTrigger>
          <AccordionContent>
            <p>If you are the winner, the prize will be yours. You can do whatever you wish with it, including selling it.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-7">
          <AccordionTrigger>How do you use my personal data?</AccordionTrigger>
          <AccordionContent>
            <p>We need to use your data to administer the competition and award prizes. We do not use your data for any other purpose.</p>
            <p className="mt-2">We do not share your data with any third parties unless this is necessary for administering the competition.</p>
            <p className="mt-2">Full details of how we use your data are included in our <Link href="/privacy" className="text-amber-400 underline underline-offset-2 hover:text-amber-300">Privacy Policy</Link>.</p>
            <p className="mt-2">If you are the winner, we may have to share your details with the Advertising Standards Authority to confirm that we have administered the competition and awarded the prizes fairly.</p>
            <p className="mt-2">You have the right to opt out from us using your data at any time. However, if you do ask us to remove your details from our database prior to the closing date, you will be withdrawing from the competition. You will not be entitled to a refund of any entry fees you have paid.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-8">
          <AccordionTrigger>If I win, do I have to participate in promotional exercises?</AccordionTrigger>
          <AccordionContent>
            <p>No, this is not compulsory. However, with your permission, we would love to share your excitement on our website and social media pages.</p>
            <p className="mt-2">Even if you do not want to participate in any promotional exercises, we may have to provide your details to the Advertising Standards Authority to prove we have administered the competition and awarded the prize fairly.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-9">
          <AccordionTrigger>What happens if I get the question wrong?</AccordionTrigger>
          <AccordionContent>
            <p>Whilst this may be disappointing, you have to remember that this is a competition and we have deliberately made the question tough to comply with the law.</p>
            <p className="mt-2">If you get the question wrong, you will not be entered into the draw so you will not have the chance to win the prize. You will not be entitled to a refund of your entry fees. If you want to, you can try again.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-10">
          <AccordionTrigger>Can I try again?</AccordionTrigger>
          <AccordionContent>
            <p>You can enter the competition as many times as you wish up to any limit we specify. Your entries may be restricted if we reach the maximum number of entries.</p>
            <p className="mt-2">Whilst this isn&apos;t gambling, we still urge you to keep this fun and not spend more than you can afford.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-11">
          <AccordionTrigger>How is the winner decided?</AccordionTrigger>
          <AccordionContent>
            <p>Everyone who gets the answer to the question correct will be entered into a draw. The winner will then be chosen at random from all the correct entries.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-12">
          <AccordionTrigger>What are my chances of winning?</AccordionTrigger>
          <AccordionContent>
            <p>The maximum number of entries is stated on each competition so your chances of winning will vary from competition to competition. As an example, if entries are capped at a maximum of 3000, this means that if you purchase 1 entry and get the answer correct, your chances of winning will be no worse than 1 in 3,000.</p>
            <p className="mt-2">You can increase your chances of winning by purchasing more entries. For example, if you purchase 10 entries in the example above and you get the answer correct, your chances of winning will be no worse than 1 in 300.</p>
            <p className="mt-2">We say &quot;no worse than&quot; because we expect a significant number of people to get the answer to the question wrong. We cannot predict how many this will be but say 500 people got the answer wrong and they each purchased 1 entry each. Your chances of winning with a single correct entry will now improve to 1 in 2,500.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-13">
          <AccordionTrigger>Why is the question so hard?</AccordionTrigger>
          <AccordionContent>
            <p>This is not a lottery or a free prize draw. It is a prize competition and the law says that to be in with a chance of winning, you must demonstrate your skill, knowledge or judgement.</p>
            <p className="mt-2">The law says that the question should be sufficiently difficult that a significant number of people either get the answer wrong or are put off entering. However, this means that the odds of winning are actually increased for those who get the answer correct.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-14">
          <AccordionTrigger>I haven&apos;t received an email confirming whether I am right or wrong.</AccordionTrigger>
          <AccordionContent>
            <p>If you haven&apos;t received an email from us confirming your entry and whether you got the question right or wrong, please check your spam folder.</p>
            <p className="mt-2">If it is not in there, please email us at <a href="mailto:info@wtf-giveaways.co.uk" className="text-amber-400 underline underline-offset-2 hover:text-amber-300">info@wtf-giveaways.co.uk</a>.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-15">
          <AccordionTrigger>Can I get a refund of my entry fee?</AccordionTrigger>
          <AccordionContent>
            <p>We do not offer refunds of entry fees if you get the answer to the question wrong, or if you are disqualified from the competition for any reason.</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="item-16">
          <AccordionTrigger>My question hasn&apos;t been answered here</AccordionTrigger>
          <AccordionContent>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-md bg-amber-400 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-300"
            >
              Contact us
            </Link>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
