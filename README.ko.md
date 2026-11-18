# herdr-mesh

[herdr](https://herdr.dev) 내부의 멀티 에이전트 워크플로를 오케스트레이션하는 MCP 서버.
에이전트 간 실시간 통신, pane 관리, 컨텍스트 핸드오프를 지원합니다.

> English: [README.md](./README.md)

## 왜 만들었나

herdr는 이미 여러 에이전트를 오케스트레이션하는 데 필요한 모든 것을 갖추고 있습니다 — 실제
pane, 영속 세션, 의미 기반 에이전트 상태(idle/working/blocked/done), 그리고 이 모두를 제어하는
CLI + 소켓 API. 하지만 **에이전트 스스로 그것을 사용할 표준 인터페이스**가 없었습니다.

그래서 herdr 안에서 여러 에이전트(Claude, Codex, …)를 띄워도, **사람이 터미널을 일일이
옮겨다니지 않고서는** 에이전트끼리 서로의 컨텍스트를 읽거나, 세션을 공유하거나, 메시지를
주고받을 깔끔한 방법이 없었습니다.

herdr-mesh는 그 간극을 메웁니다: herdr의 CLI를 **MCP tool**로 노출하여, MCP를 지원하는 어떤
에이전트든 — 타입에 관계없이 — 다른 에이전트의 pane을 읽고, 컨텍스트를 넘기고, 작업을
조율하고, 새 에이전트를 띄우는 일을 **자연어 지시만으로 스스로** 하게 합니다. 목표는 herdr의
멀티 에이전트 워크플로를 **에이전트 자신이** 하나의 표준·에이전트 비종속 인터페이스로
프로그래밍할 수 있게 만드는 것입니다.

## 유즈케이스

터미널을 오가는 번거로운 작업을 한 문장의 자연어 지시로 바꾸는 구체적 상황들입니다.

### 1. 코딩 → 리뷰 → 수정 루프

Claude에게 코딩을 시키고 Codex에게 리뷰를 맡깁니다. Codex가 버그를 발견했습니다 — 보통은
그걸 사람이 직접 Claude에게 복사해 넘겨야 하죠. 대신:

> "Codex한테 방금 Claude가 한 변경을 리뷰시켜. 문제를 찾으면 Claude한테 보내서 고치게 하고,
> 다시 Codex에게 재리뷰시켜. 깨끗해질 때까지 반복해."

조율 에이전트가 `herdr_agent_read`(Codex 리뷰 회수) → `herdr_agent_send`(지적사항을 Claude에게
전달) → `herdr_agent_wait`(Claude 작업 완료 대기) → 리뷰 반복을 스스로 돌립니다. pane 간
복사·붙여넣기가 사라집니다.

### 2. 병렬 분담

> "이 리팩터를 나눠줘: API 레이어는 Claude, 테스트는 Codex가 맡게 하고, 둘 결과를 모아서
> 요약해줘."

`herdr_agent_start` / `herdr_agent_send`로 두 에이전트에 작업을 분배하고, 각각
`herdr_agent_wait`로 기다린 뒤, `herdr_agent_read`로 결과를 합칩니다.

### 3. 롱러닝 작업 핸드백

> "빌드 에이전트한테 전체 테스트 돌리게 하고, PASS나 FAIL 뜰 때까지 기다렸다가 실패 케이스
> 가져와줘."

`herdr_pane_run`으로 실행을 시작하고 `herdr_wait_output`으로 결과를 기다립니다 — pane을 계속
지켜볼 필요 없이 끝나는 순간 알려줍니다.

### 4. 막힌 에이전트 해제

어떤 에이전트가 확인 입력을 기다리며 멈춰 있는데(`blocked`), 당신은 다른 pane에 몰입 중입니다.

> "입력 기다리며 막힌 에이전트 있어? Codex가 y/n 프롬프트에서 멈춰 있으면 승인해서 계속
> 진행시켜."

`herdr_agent_list`가 `blocked` 상태를 드러내고, `herdr_agent_send` + `herdr_pane_send_keys`로
프롬프트에 응답합니다 — 당신은 하던 일을 멈추지 않아도 됩니다.

### 5. 설계 → 구현 → 검증 파이프라인

> "*architect* 에이전트 pane에 있는 설계를 Claude에게 줘서 구현시키고, 그 결과를 *tester*
> 에이전트가 테스트 돌리게 해."

`herdr_agent_read`로 설계를 읽고, `herdr_agent_send`로 넘기고, `herdr_agent_wait`로 기다린 뒤,
세 번째 에이전트에서 검증을 실행합니다 — 한 번의 지시로 도는 3단 릴레이.

### 6. 컨텍스트를 가진 에이전트에게 질문 라우팅

> "결제 서비스에서 작업 중인 에이전트가 그 코드를 이미 띄워놨잖아 — 웹훅이 왜 재시도하는지
> 걔한테 물어보고 답 가져와줘."

당신이 컨텍스트를 다시 로드할 필요 없이, `herdr_agent_send`로 이미 그 코드베이스에 있는
에이전트에게 질문하고 `herdr_agent_read`로 답을 받아옵니다.

요점: **사람이 중간에 끼어야 했던 에이전트 간 핸드오프가 한 문장이 됩니다.**

herdr는 자신의 워크스페이스/에이전트 런타임을 CLI + 소켓 API로 노출합니다. `herdr-mesh`는
그 CLI를 [Model Context Protocol](https://modelcontextprotocol.io) tool로 감싸므로, 어떤
MCP 클라이언트든 다른 에이전트의 pane을 읽고, 메시지를 보내고, 세션을 조회하고, 새
에이전트를 띄우는 일을 표준 인터페이스로 할 수 있습니다.

**에이전트 비종속(agent-agnostic):** tool은 herdr가 인지하는 모든 에이전트
(`pi`, `omp`, `claude`, `codex`, `opencode`, `hermes`, `qodercli` 및 향후 통합)에 동작합니다.
target에는 **실행 중인 에이전트 이름**(`[a-z][a-z0-9_-]{0,31}`) 또는 **그 에이전트가 있는 pane
id**를 쓸 수 있으며, terminal id와 에이전트 종류 라벨은 허용되지 않습니다. 특정 에이전트
타입에 묶여 있지 않습니다. 사용 가능한 목록은 `herdr_integration_status`로 확인하세요.

## 동작 방식

```
MCP 클라이언트 ──stdio(MCP)──> herdr-mesh ──exec "herdr …"──> herdr CLI ──소켓──> herdr 서버
```

각 tool은 `herdr` CLI를 서브프로세스로 실행하고 JSON 출력을 반환합니다. 별도 프로토콜 구현
없이, herdr 자체의 버전/프로토콜 처리를 그대로 신뢰합니다.

## 요구 사항

- Node.js 18 이상
- [herdr](https://herdr.dev) 설치 및 서버 실행 상태(`herdr status`가 `running` 표시).
  **herdr ≥ 0.9.5 필요.** `herdr`가 `PATH`에 없으면 `HERDR_BIN` 환경변수로 경로를 지정하세요.
  herdr-mesh 0.2.0은 0.9.5 CLI(`agent prompt`, `pane wait-output`, `agent start --kind`)를
  대상으로 하며, 이전 herdr 버전에서는 동작하지 않습니다.

## 설치 (권장)

전역 설치 후, 내장 설치 도우미가 에이전트를 감지해 자동 등록합니다:

```bash
npm i -g https://github.com/runchr-works/herdr-mesh/archive/refs/heads/main.tar.gz
herdr-mesh install
```

> npm 레지스트리가 아니라 **GitHub에서 직접 설치**합니다. repo에 빌드된 `dist/`가 포함돼 있어
> 설치에는 네트워크만 있으면 되고 별도 빌드 단계가 없습니다. 나중에 업데이트하려면 같은 명령을
> 다시 실행하세요.
>
> git 설치를 깔끔히 처리하는 npm 환경에서는 더 짧은 `npm i -g runchr-works/herdr-mesh`도
> 됩니다. 이게 `herdr-mesh` 명령을 못 만들면 위의 tarball URL을 쓰세요. 전역 설치 자체가 싫다면
> [수동 등록](#수동-등록)을 보세요 — `npx`는 전역 설치 없이 동작합니다.

`herdr-mesh install`은 설치된 에이전트를 감지하고, 선택한 에이전트에 herdr-mesh를 등록합니다:

- **Claude Code** — `claude mcp add -s user`로 등록
- **Codex** — `~/.codex/config.toml`에 `[mcp_servers.herdr-mesh]` 추가
- **opencode** — `~/.config/opencode/opencode.json`에 병합
- 그 외 에이전트 — 붙여넣을 설정 스니펫을 정확히 출력

**안전합니다**: 기존 설정은 파싱·병합하며(통째로 덮어쓰지 않음), 쓰기 전 `.bak` 백업을 만들고,
재실행 시 이미 등록된 에이전트는 건너뜁니다. `herdr-mesh install -y`로 감지된 모든 에이전트에
비대화형으로 등록할 수 있습니다.

등록 후 에이전트를 재시작하면 herdr-mesh가 적용됩니다.

## 수동 등록

각 에이전트는 각자가 MCP 클라이언트입니다. 사용하는 에이전트마다 한 번씩 등록하세요. 같은
머신의 모든 에이전트는 동일한 herdr 소켓을 공유하므로 서로를 인지하고 메시지를 주고받습니다.
서버 명령은 (전역 설치 후) `herdr-mesh`입니다.

Claude Code:

```bash
claude mcp add -s user herdr-mesh herdr-mesh
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.herdr-mesh]
command = "herdr-mesh"
```

일반 MCP 설정(stdio):

```json
{
  "mcpServers": {
    "herdr-mesh": {
      "command": "herdr-mesh"
    }
  }
}
```

> 전역 설치가 싫다면 `herdr-mesh` 대신 `npx -y runchr-works/herdr-mesh`를 명령으로 쓰세요
> (npx가 GitHub에서 빌드된 repo를 받아옵니다 — 첫 실행은 다운로드로 조금 느립니다).

## 소스에서 빌드 (로컬 개발)

```bash
git clone https://github.com/runchr-works/herdr-mesh.git
cd herdr-mesh
npm install
npm run build
node dist/index.js          # 서버 직접 실행
node dist/index.js install  # 또는 소스에서 설치 도우미 실행
```

## 사용법 — 그냥 에이전트에게 말하면 됩니다

tool 이름을 직접 입력하지 않습니다. 평소처럼 에이전트(Claude, Codex, …)에게 **자연어로**
말하면, 에이전트가 알아서 herdr-mesh tool을 호출하고 결과를 정리해 답합니다. 아래는 "이렇게
말하면 이런 동작을 한다"의 예시입니다.

**무엇이 떠 있는지 보기**
- "지금 herdr에 어떤 에이전트들 떠 있어?" → 에이전트 목록 + 상태
- "herdr가 어떤 에이전트 통합을 지원해?" → 통합 상태

**다른 에이전트의 컨텍스트 읽기 (핸드오프 수신)**
- "codex 패널 읽어서 걔가 뭐 하는지 요약해줘."
- "*reviewer* 에이전트의 마지막 100줄 가져와줘."

**메시지 전송 / 작업 넘기기**
- "codex한테 '이 브랜치 diff 리뷰해줘'라고 보내."
- "*reviewer* 에이전트한테 테스트 돌리고 결과 알려달라고 해."
- "pane w65343…-3 에 `npm test` 보내서 실행해줘." (Enter까지 눌러 실행)

**조율 / 대기**
- "codex가 idle 되면 다음 작업 보내줘."
- "빌드 패널 지켜보다가 'BUILD SUCCESS' 뜨면 알려줘."

**에이전트 띄우기 / 관리**
- "오른쪽 split에 새 codex 에이전트 띄워서 내 작업 리뷰시켜."
- "*tester*라는 이름으로 claude 에이전트 새로 열어줘."

**세션 & 워크스페이스**
- "herdr 세션 목록 보여줘." / "docs 프로젝트용 새 워크스페이스 만들어줘."

자연어만으로 이루어지는 전형적 핸드오프:

> "내 현재 변경사항을 새 codex 에이전트에게 넘겨 리뷰시키고, 끝날 때까지 기다렸다가, 그
> 피드백을 요약해줘."

에이전트가 `herdr_agent_start` → `herdr_agent_send` → `herdr_agent_wait` →
`herdr_agent_read`를 알아서 연결해 실행합니다.

**말할 때 알아두면 좋은 점**
- 메시지를 **그냥 전달**할지, **실행/제출까지** 시킬지 분명히 말하세요 — 예: "전달만 해줘" vs
  "보내고 실행까지 해줘". (전달만 하면 상대 입력칸에 글자만 들어가고 Enter는 안 눌립니다.)
- 출력이 비어 보이면 "**지금 화면** 기준으로 보여줘"처럼 요청하세요. "최근 명령 출력"은
  추적된 구간이 없으면 비어 있을 수 있습니다.

## Tool 목록 (LLM용 레퍼런스)

아래는 에이전트에게 노출되는 tool 이름입니다 — 참고용이며, 사람이 입력하는 것이 아닙니다.

**에이전트 메시지 & 컨텍스트 (핵심)**
- `herdr_relay` — 에이전트에 메시지를 전달하고 **제출까지**(`agent prompt`). 메시지 전송엔
  이걸 우선 사용 — "쳤는데 제출 안 됨" 실수를 막아줍니다. `submit: false`면 `pane send-text`로
  글자만 입력합니다.
- `herdr_handoff` — 작업을 보내고, 에이전트가 끝날 때까지 기다린 뒤, 결과를 읽어오는 것까지
  한 번에. `wait_status`, `read_source`, `read_lines`, `timeout_ms`를 받습니다.
  리뷰/수정/검증 루프에 우선 사용 — 체인이 중간에 끊기지 않습니다.
- `herdr_agent_list` — 에이전트 목록과 상태(idle/working/blocked/done)
- `herdr_agent_get` — 에이전트 상세
- `herdr_agent_read` — 다른 에이전트의 pane 출력 읽기 (source: `visible`, `recent`,
  `recent-unwrapped`, `detection`)
- `herdr_agent_send` — 저수준: 에이전트에 텍스트만 입력 (Enter 없음; `pane send-text` 사용)
- `herdr_agent_send_keys` — 키 입력 전송 (`enter`, `esc`, `tab`, `ctrl+c`, `up`, …)
- `herdr_agent_prompt` — 프롬프트 제출(텍스트 + Enter). 선택: `wait`, `until`, `timeout_ms`
- `herdr_agent_wait` — 에이전트가 특정 상태가 될 때까지 대기. `until`은 단일 상태 또는 배열을
  받고, `status`는 레거시 별칭으로 유지됩니다. 둘 다 생략하면 herdr 기본값
  (idle, done 또는 blocked)을 기다립니다.
- `herdr_wait_output` — pane 출력이 텍스트/정규식과 일치할 때까지 대기
  (`pane wait-output`). `source`, `lines`, `timeout_ms`, `raw` 지원

**에이전트 생애주기 & 탐색**
- `herdr_agent_start` — pane에서 지원 에이전트를 시작합니다. 입력: `name`(필수),
  `kind`(필수: `pi`, `claude`, `codex`, `gemini`, `cursor`, `devin`, `agy`, `cline`, `omp`,
  `mastracode`, `opencode`, `copilot`, `kimi`, `kiro`, `droid`, `amp`, `grok`, `hermes`,
  `kilo`, `qodercli`, `qwen`, `letta`, `maki`, `muse`)와 선택 `args`(`--` 뒤 에이전트 인자),
  `pane_id`, `workspace`, `split_from` + `direction`, `split`, `cwd`, `focus`, `timeout_ms`.
  `pane_id`가 없으면 workspace/tab/pane을 먼저 만들고, 시작에 실패하면 정리합니다.
  - **0.1.0 대비 호환성 깨짐:** `argv` → `kind` + `args`; `tab` 제거. `split`(right/down)은
    계속 동작하며 현재 pane을 분할합니다.
- `herdr_agent_rename`, `herdr_agent_focus`
- `herdr_integration_status` — herdr가 인지하는 에이전트 통합 목록과 상태

**세션**
- `herdr_session_list`, `herdr_session_stop`, `herdr_session_delete`

**Pane**
- `herdr_pane_list` / `get` / `read` / `split` / `run` / `send_text` / `send_keys` / `close` / `rename`
- 명령을 입력하고 **Enter까지** 누르려면 `herdr_pane_run`을, 글자만 입력하려면 `*_send_text`를 사용.

**Tab & Workspace**
- `herdr_tab_*` — list / create / get / focus / rename / close
- `herdr_workspace_*` — list / create / get / focus / rename / close

## 동작 참고 (LLM·개발자용)

아래는 tool의 동작 세부사항입니다 — 사람용 팁이 아니라, LLM이 tool을 올바르게 쓰거나
개발자가 동작을 이해할 때 참고하는 내용입니다.

- **메시지/명령 전송**
  - 글자만 전달: `herdr_agent_send` (Enter 누르지 않음)
  - 제출까지: `herdr_agent_prompt` / `herdr_relay`
  - 특수 키 전송: `herdr_agent_send_keys` 또는 `herdr_pane_send_keys`
    (`enter`, `esc`, `tab`, `ctrl+c`, `up`, `down`, `left`, `right`, …)
  - 셸 명령 실행: `herdr_pane_run` (입력 + Enter 한 번에) — 가장 간편
- **target**: 실행 중인 에이전트 이름 또는 그 에이전트가 있는 pane id를 사용하세요.
  herdr 0.9.5는 terminal id와 에이전트 종류 라벨을 거부합니다. 유효한 이름은
  `herdr_agent_list`로 확인하세요.
- **키 이름**: `esc`가 표준이며(`escape`도 허용되어 정규화됨), `ctrl-c`·`Ctrl-Shift-C` 같은
  수정자 표기는 `ctrl+c` / `ctrl+shift+C`로 변환됩니다.
- **출력 읽기**: 컨텍스트 회수에는 `source: "visible"`이 화면 내용을 가장 안정적으로 반환합니다.
  `recent` / `recent-unwrapped`는 추적된 명령 출력 영역이 없으면 빈 값일 수 있습니다.
  `detection`은 herdr가 에이전트 감지에 사용한 내용을 읽습니다.

## 컨텍스트 & 세션 공유에 대하여

- **컨텍스트 공유**: `herdr_agent_read`로 다른 에이전트 출력을 가져오고(pull),
  `herdr_agent_send` / `herdr_pane_run`으로 전달(push)합니다.
- **세션**: 같은 herdr 서버에 붙은 모든 에이전트는 이미 하나의 세션(소켓)을 공유합니다 —
  이것이 컨텍스트 공유의 토대입니다. MCP로는 세션 조회/관리(`session_list`/`stop`/`delete`)가
  가능합니다. 사람이 원격으로 같은 세션에 접속하는 `session attach`는 herdr 네이티브 기능
  (SSH attach)이며 인터랙티브 동작이라 MCP tool에서는 의도적으로 제외했습니다.

## 문제 해결 (Troubleshooting)

자연어 지시는 대체로 잘 동작하지만, 최종적으로 tool을 호출할지·어떻게 호출할지는 에이전트
(LLM)가 결정하므로 100% 결정적이지는 않습니다. 의도대로 안 되면:

- **행동 없이 말로만 답한 경우** — 명시적으로 지시하세요: "herdr-mesh로 codex에 메시지 보내",
  "herdr 툴 호출해서 처리해" 처럼 능력을 직접 언급.
- **보냈는데 실행이 안 된 경우** — `herdr_agent_send`는 Enter를 안 누릅니다. "보내고 **실행까지**
  해줘"라고 하거나, 제출을 자동으로 하는 `herdr_relay` / `herdr_handoff`를 쓰세요.
- **대상이 틀리거나 모호한 경우** — "먼저 에이전트 목록부터 보여줘"라고 한 뒤 그 목록의
  이름/id로 지정.
- **읽었는데 비어 있는 경우** — "**지금 화면** 기준으로 보여줘"(`source: visible`)라고 요청.
  추적된 "최근 출력"은 비어 있을 수 있습니다.
- **여러 단계 핸드오프가 중간에 멈춘 경우** — 에이전트가 여러 호출을 직접 잇게 하지 말고
  `herdr_handoff`(send + wait + read 한 번에)를 쓰세요.
- **tool 자체가 안 보이는 경우** — 서버 연결 확인: `claude mcp list` 또는 세션 안에서 `/mcp`.
  herdr 실행 여부는 `herdr status`로 확인.
- **그래도 막히면** — 에러는 herdr 원문 그대로 반환되니 "받은 에러 그대로 보여줘"라고 하세요.
  보통 원인(`agent_not_found` 등)이 적혀 있습니다.

## 개발

```bash
npm run dev    # tsx로 소스에서 바로 실행
npm run build  # dist/로 컴파일
```

> `dist/`는 커밋되어 있어 GitHub에서 빌드 단계 없이 설치됩니다. `src/`를 수정한 뒤에는
> `npm run build`를 실행하고 `dist/`도 함께 커밋하세요.

## 라이선스

MIT
