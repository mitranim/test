MAKEFLAGS := --silent --always-make
PAR := $(MAKE) -j 128
# `--unstable` is required for the console size API.
DENO := deno run --allow-hrtime --no-check --unstable
RUN := $(if $(run),--run "$(run)",)
VERB := $(if $(filter $(verb),true),-v,)
TEST := test/test_test.mjs $(VERB) $(RUN)
BENCH := test/test_bench.mjs $(VERB) $(RUN)
PORT := 58729

test_w:
	$(DENO) --watch $(TEST)

test:
	$(DENO) $(TEST)

bench_w:
	$(DENO) --watch $(BENCH)

bench:
	$(DENO) $(BENCH)

lint_w:
	watchexec -r -d=0 -e=mjs -n -- make lint

lint:
	deno lint --rules-exclude=no-empty

watch:
	$(PAR) test_w lint_w

# Requires manual `make dep`.
# Requires disabling network cache in browser devtools.
# TODO replace with something Deno based (afr).
srv:
	echo http://localhost:$(PORT)/test/test.html
	echo http://localhost:$(PORT)/test/bench.html
	srv -p $(PORT)

prep: lint test

dep:
	go install github.com/mitranim/srv/srv@latest
