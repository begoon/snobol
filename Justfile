default:
    @just --list

test:
    bun test

typecheck:
    bunx tsc --noEmit

ci: typecheck test

publish: ci
    npm version patch --no-git-tag-version
    npm publish
