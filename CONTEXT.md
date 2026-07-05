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
