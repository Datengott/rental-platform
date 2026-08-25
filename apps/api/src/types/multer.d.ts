// nest-cli's build doesn't always auto-pick up @types/multer's ambient
// Express.Multer.File augmentation across the workspace hoist; referencing
// it explicitly here makes sure it's part of the compiled program.
/// <reference types="multer" />
