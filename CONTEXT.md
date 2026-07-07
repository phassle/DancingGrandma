# DancingGrandma Context

DancingGrandma turns one person photo and one reference dance video into a shareable vertical dance clip. This glossary keeps the product language precise so agents do not drift into generic video-generation terms.

## Language

**Character Animation**:
A person image is animated to follow the motion from a reference video while preserving the visible identity of the supplied person.
_Avoid_: generic image-to-video, prompt-only video generation

**Human Image Animation**:
Research term for character animation when the source image is a human/person image.
_Avoid_: image-to-video when exact reference motion is required

**Motion Transfer**:
The motion, timing, pose, and expression cues from a reference dance video are transferred to the person image.
_Avoid_: style transfer, prompt inspiration

**Reference Motion Video**:
The uploaded, imported, or curated dance clip that supplies the movement to copy.
_Avoid_: prompt reference, style reference

**Character Replacement**:
The supplied person image replaces the performer in a reference video while preserving the reference motion and scene context.
_Avoid_: face swap when body motion and scene integration are also in scope

**Generated Dance Video**:
The final vertical video where the supplied person performs the reference dance motion, with reference music preserved or muxed in.
_Avoid_: AI video when describing the domain contract

**Generic Image-To-Video**:
A broader video-generation capability that animates a still image from a prompt without necessarily consuming a reference motion video. It is not a wired DancingGrandma engine unless it also performs character animation or character replacement.
_Avoid_: using this as the core product name

**Credit**:
The paid usage unit a user spends to receive a completed generated dance video.
_Avoid_: token, point, provider cost

**Credit Wallet**:
The user's spendable and reserved credit position.
_Avoid_: balance column, payment account

**Credit Purchase**:
A paid top-up that grants credits to a user's credit wallet after payment is confirmed.
_Avoid_: subscription, invoice, recharge

**Subscription**:
A recurring DancingGrandma membership that grants credits every billing period while active.
_Avoid_: one-time credit purchase, Stripe account

**Credit Reservation**:
A temporary hold on credits for a generation that has started but has not yet delivered a final video.
_Avoid_: charge, spend, payment

**Credit Expiration**:
The removal of unused credits after the user has been inactive for the product-defined inactivity window.
_Avoid_: refund, provider timeout

**Account Activity**:
An authenticated user presence in DancingGrandma that keeps the user's paid credits from expiring.
_Avoid_: anonymous draft activity, payment provider activity

**Pre-Account Draft**:
The in-browser working state where a visitor has selected a person photo and reference motion source before creating an account.
_Avoid_: anonymous account, stored upload

**Generation Gate**:
The account, credit, and payment boundary shown when a visitor tries to start a paid generation.
_Avoid_: dark pattern, surprise paywall

**Generation Job**:
A durable record of one attempt to turn a person photo and reference motion video into a generated dance video.
_Avoid_: request, render if no durable state exists

**Stored Generated Video**:
The generated dance video after it has been copied into DancingGrandma-controlled storage.
_Avoid_: provider URL, temporary result
