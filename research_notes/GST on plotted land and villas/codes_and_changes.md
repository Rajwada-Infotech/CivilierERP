# SAC/HSN codes and 2024-2026 GST changes for plotted land and villas (India)

Research cut-off: 2 Oct 2026. Primary government pages (PIB, cbic-gst.gov.in) partly blocked fetches (403), so several items rest on secondary summaries (taxguru, taxo, irisgst). These are flagged.

## Which SAC codes apply to each line type

### Takeaway
All construction-type lines fall under SAC heading 9954. 995411 covers construction of single-dwelling and multi-dwelling residential buildings, so it fits both a villa built for a customer and RREP apartments. Sale of land is not a supply under GST, and no official SAC exists for it. I found no official source for a specific sub-code for plot development, maintenance, club or transfer fees.

### Cited Findings
- 9954 is the SAC heading for construction services. 995411 = construction services of single-dwelling, multi-dwelling or multi-storied residential buildings. 995412 = other residential buildings (old-age homes, hostels and similar). 995414 = commercial buildings — [mybillbook SAC 9954](https://mybillbook.in/s/sac-code/construction-services-sac-code-9954/); [getatoz 99541](https://www.getatoz.co/sac/code/99541/construction-services-of-buildings)
- The rates for RREP apartments are unchanged under GST 2.0: affordable residential 1%, other residential 5%, both without ITC, and commercial apartments in an RREP 5%. An RREP is a project where commercial carpet area is no more than 15% of the total — [busy.in summary](https://busy.in/gst/applicability-of-gst-on-real-estate/)
- Preferential location charges (PLC) collected with the construction consideration before the completion certificate are part of a composite supply. They take the same rate as the main construction service and should use the same SAC. Source: Circular 234/28/2024-GST dated 11.10.2024 — [irisgst](https://irisgst.com/gst-circular-no-234-234-28-2024-clarifications-regarding-applicability-of-gst-on-certain-services/); [taxguru](https://taxguru.in/goods-and-service-tax/clarification-gst-applicability-services.html). The Punjab & Haryana High Court took the same view — [taxo](https://taxo.online/latest-news/preferential-location-charges-plc-is-taxable-at-the-same-gst-rate-applicable-to-construction-services-and-cannot-be-treated-as-an-independent-supply-punjab-and-haryana-high-court/)
- All works contracts are now at 18% with ITC from 22.09.2025, because the concessional 12% government works-contract entries were withdrawn. This covers construction of a villa for an individual customer under a works contract — [taxgarden](https://taxgarden.in/blog/gst-on-works-contract-construction-services-india-2026); [gstvidhi](https://gstvidhi.com/articles-gst-vidhi-act-detail.aspx?id=2532)

### Inferences
- Suggested ERP mapping:
  - land value: no SAC, non-GST, Schedule III para 5 of the CGST Act (sale of land) — this comes from statute knowledge, not fetched
  - villa works contract: 995411 at 18%
  - RREP unit construction: 995411 at 1% or 5%
  - PLC: same SAC as the main supply
  - plot development or site works sold separately: likely 9954 (the site-preparation group 99543 or civil works 99542). Confirm against the official SAC scheme.
  - maintenance / RWA-type charges: likely 9995 or 9972. Not verified.
- If PLC or development charges are collected after the completion certificate, the composite-supply logic no longer applies. They are then a separate supply, usually at 18%.

### Gaps
- I could not fetch the official CBIC SAC scheme PDF. Sub-codes for land development, club membership, maintenance and transfer fees are unverified.
- I found no CBIC circular that addresses "developed plot" sales with development charges directly in 2024-2026.

## Invoice and GSTR-1 reporting of land value and non-GST supplies

### Takeaway
Nil-rated, exempt and non-GST outward supplies go in GSTR-1 Table 8. Older guidance put only taxable supplies in Table 12 (HSN summary), but newer guidance says HSN must now be disclosed for exempt and nil-rated supplies too. Whether reporting land value is mandatory was not confirmed by any official source.

### Cited Findings
- Table 8 captures nil-rated, exempt and non-GST outward supplies. Older guidance said Table 12 covers only taxable supplies — [taxguru](https://taxguru.in/goods-and-service-tax/show-nil-rated-supply-gstr-1.html)
- Newer rule: HSN disclosure in Table 12 is now required even for exempt and nil-rated supplies — [taxguru GSTR-1 amendments](https://taxguru.in/goods-and-service-tax/gstr-1-amendments-key-changes-in-tax-reporting.html); [webtel](https://webtel.in/Blog/Navigating-the-Latest-Changes-in-Table-12-of-GSTR-1-1A-What-Every-GST-Registered-Business-Needs-to-K/3497)

### Inferences
- Land is "non-GST", not "exempt", so it belongs in the Table 8 non-GST column if it is reported at all.
- Showing the land value on the invoice as a separate line is good practice. Under the RREP scheme, one-third of the value is deemed to be land.

### Gaps
- I did not verify the GSTN advisory number or date for the Table 12 exempt-HSN change.
- I found no authoritative statement on whether reporting land value in Table 8 or in e-invoices is mandatory. E-invoice treatment of non-GST lines was not verified.

## GST Council decisions, notifications and Finance Act amendments, 2024-2026

### Takeaway
Developers are affected by these changes:
- **53rd Council:** RERA collections made exempt.
- **54th Council:** PLC clarified, and RCM brought in on commercial renting.
- **55th Council:** decision on the FSI/realty RCM question deferred.
- **Finance Act 2025:** retrospectively overturned Safari Retreats.
- **56th Council (GST 2.0):** works contracts made a flat 18%, while the RREP 1%/5% rates stayed.
- **57th Council:** due 7 Oct 2026, not yet held.

### Cited Findings
- **53rd Council, 22.06.2024:** statutory collections by RERA clarified as exempt under entry 4 of Notification 12/2017-CT(R). Implemented through the services circular 228/22/2024-GST — [razorpay](https://razorpay.com/learn/53rd-gst-council-meeting/); [CBIC circular 228](https://cbic-gst.gov.in/pdf/circular-services-228-22-2024-GST.pdf)
- **54th Council, 09.09.2024:**
  - PLC is part of the composite construction supply when collected before the completion certificate. This became Circular 234/28/2024-GST dated 11.10.2024.
  - Renting of commercial property by an unregistered person to a registered person brought under RCM.
  - Sources: [PIB 54th](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2053233); [irisgst](https://irisgst.com/gst-circular-no-234-234-28-2024-clarifications-regarding-applicability-of-gst-on-certain-services/); [taxo 14.10.2024](https://taxo.online/latest-news/14-10-2024-cbic-issued-various-gst-related-clarifications-and-amendments-discussed-in-the-54th-gst-council-meeting/)
- **Supreme Court, Safari Retreats, 03.10.2024:** held that "plant or machinery" in s.17(5)(d) differs from "plant and machinery", so a building can be a "plant" under a functionality test — [amlegals](https://amlegals.in/gst-insights/safari-retreats-itc-construction)
- **55th Council, 21.12.2024:** decision on FCM vs RCM for the realty sector (GST on FSI) postponed — [irisgst](https://irisgst.com/55th-gst-council-meeting-key-highlights/)
- **Finance Act 2025:**
  - Replaced "plant or machinery" with "plant and machinery" in s.17(5)(d), retrospectively from 01.07.2017, which nullifies Safari Retreats.
  - The section number is reported inconsistently: Clause 119 of the Bill per [amlegals](https://amlegals.in/gst-insights/safari-retreats-itc-construction), but Section 124 of the Act per [taxguru](https://taxguru.in/goods-and-service-tax/gst-amendments-finance-act-2025-effective-oct-1-2025-notified.html).
  - Notification 16/2025-Central Tax dated 17.09.2025 brought the Finance Act 2025 GST provisions into force on 01.10.2025 — [taxo](https://taxo.online/latest-news/18-09-2025-cbic-notifies-1st-october-2025-as-effective-date-for-key-gst-provisions-of-finance-act-2025/); [taxguru](https://taxguru.in/goods-and-service-tax/gst-amendments-finance-act-2025-effective-oct-1-2025-notified.html)
- **56th Council, 03.09.2025 (GST 2.0):**
  - New 5% / 18% / 40% structure, effective 22.09.2025.
  - The services rate changes were made by Notification 15/2025-CT(R) dated 17.09.2025, which amends Notification 11/2017.
  - Works contracts that are mainly earthwork (>75%) for Government, offshore oil and gas works contracts, and their sub-contracts moved from 12% to 18%.
  - Sources: [taxo](https://taxo.online/latest-news/18-09-2025-cbic-issued-notifications-to-give-effect-to-the-recommendations-of-the-56th-council-meeting-in-respect-to-rate-and-exemption-on-services/); [PIB 56th (403 on fetch)](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163555&reg=48&lang=2)
- **Changes to Notification 11/2017 item 3 entries:** the RREP residential 1%/5% (no ITC) rates are reported as unchanged after GST 2.0 — [busy.in](https://busy.in/gst/applicability-of-gst-on-real-estate/)
- **57th Council:** first set for 12.09.2026, then rescheduled to 07.10.2026. Blocked-credit rationalisation after Safari Retreats is reported to be on the agenda — [taxguru](https://taxguru.in/goods-and-service-tax/57th-gst-council-meeting-rescheduled-october-7-2026-legal-analysis.html); [aninews](https://aninews.in/news/business/57th-gst-council-meeting-to-be-held-on-september-12-in-new-delhi20260829182314/)

### Inferences
- A villa built for a customer under a works contract is 18% with ITC. A villa or plot sold as part of an RREP before completion stays at 1%/5% without ITC.
- ITC on a developer's own buildings, such as a clubhouse, cannot be claimed under the "plant" argument.

### Gaps
- I did not read the full text of Notification 15/2025-CT(R). Individual changes to item 3 sub-entries (i)-(xii), such as 3(iv), 3(v), 3(xii) or the government works-contract entries 3(vi)/(ix)/(x), still need to be confirmed against the CBIC PDF.
- I did not identify the notification number for the 54th Council's commercial-renting RCM change. It is reportedly 09/2024-CT(R) dated 08.10.2024, but this is unverified.
- The 57th Council outcomes are not yet known because the meeting is set for 07.10.2026.
