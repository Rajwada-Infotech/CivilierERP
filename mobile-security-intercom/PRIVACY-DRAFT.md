# Civilier Security: privacy and consent (DRAFT for legal review)

This is a working draft written from what the app actually does. It is not legal advice and has not been reviewed.
Legal should check it against the DPDP Act 2023 and the Play Store and App Store rules before it is published or
shown to anyone.

## What the app collects, from whom, and why

| Data | Whose | When | Why | Kept |
|---|---|---|---|---|
| Location (GPS), accuracy, battery level | Guards | Only between shift start and end (15 min either side), after the guard agrees in the app | To show supervisors that the gate is covered, and to raise "left the zone" and "device offline" alerts | 90 days, then deleted |
| Visitor photo | Visitors | When a guard raises a visitor request | So the resident can see who is at the gate | 90 days, then deleted |
| Visitor name, phone, vehicle number, reason | Visitors | When a guard raises a request or a resident makes a guest pass | So the resident can decide, and for the gate's visitor log | With the visitor record |
| Approve / deny decisions, time, device id | Residents | When a resident answers a request | An audit record of who let whom in | With the visitor record |
| Call records (who, when, how long), not the audio | Residents, guards | When a call is made in the app | A record of contact between the gate and residents | With the call record |
| Push notification token | All users | When the app registers for notifications | To deliver visitor requests, calls and alerts | Until sign-out or the token expires |

Voice calls go through LiveKit (a calling service). Audio is not recorded or stored by Civilier.

## Who can see it

- Guards see the flats at their gate and the requests they raised. They see residents' phone numbers only for a
  request they raised, to call the flat.
- Residents see only the requests for their own flats, and those visitors' photos.
- Security supervisors see guards' locations, trails and alerts, and the visitor log, for the projects they are
  allowed to manage.
- Visitor photos are never public. They are served only to the people above, after they sign in.

## Consent text shown in the app (guard)

> **Location on shift.** During your shift, and only then, the app shares your phone's location every few seconds with
> the security supervisor, so they can see you are at your gate. It stops when your shift ends. Nothing is shared off
> shift. [I agree — share during my shift]

The guard can stop sharing at any time ("Stop sharing"). The supervisor then sees the phone as offline.

## Open questions for legal

1. Is consent the right basis for guard tracking, or should it be legitimate use under the guards' employment or
   security-agency contract? If consent is used, what happens when a guard refuses?
2. Visitor photos: is a notice at the gate needed (for example, "Visitors are photographed for the residents'
   approval"), and in which languages?
3. Is 90 days right for location and photos? Do housing societies need longer for incident investigation?
4. Data processors: Expo (push), LiveKit (calls) and OpenStreetMap (map tiles) are third parties. Is a data-processing
   agreement needed with each?
5. Google Play "background location" declaration: justification text and the demo video Google requires.
6. App Store: the background location usage strings in app.json (NSLocationAlwaysAndWhenInUseUsageDescription) need
   legal sign-off.

## Store wording drafts (for the listings)

- **Play Store background location justification:** "Civilier Security is used by security guards at residential
  projects. While a guard is on shift, and only then, the app shares their location with their security supervisor so
  the supervisor can confirm the gate is covered and be alerted if the guard leaves their post. Tracking starts only
  after the guard agrees, and stops automatically when the shift ends."
- **Privacy policy URL:** needed before submission. Host it on the company website.
