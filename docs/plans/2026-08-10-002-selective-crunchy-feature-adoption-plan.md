---
title: Selective crunchy feature adoption audit
type: audit
date: 2026-08-10
execution: knowledge-work
baseline: 7e43d82
source_ref: crunchy/main
---

# Выборочный аудит возможностей `crunchy/main`

## Контекст и границы

`main` и `crunchy/main` расходятся после `6d7d14b`. Аудит выполнен относительно текущего `main` на `7e43d82`; повторно переносить или оценивать исправление выбора prefixed thread не нужно, потому что текущий форк уже принял собственное решение в `eb98274`.

Задача этого документа: отделить четыре независимые возможности из `crunchy/main`, оценить их против текущей архитектуры и наметить узкие переносы. Wholesale cherry-pick диапазона `431a349..da01340` исключён. В нём смешаны relay-протокол, сложная машина удержания клавиши, локальная автоматизация macOS, Otty/pi, старые package UUID `com.simeo.codex-deck`, прежние метаданные автора, версии пакета, README и изображения.

Ограничения текущего форка, которые имеют приоритет:

- Windows-only, macOS-only и optional multi-host должны продолжать работать независимо.
- CDP остаётся на `127.0.0.1`; удалённые операции проходят только через аутентифицированный типизированный relay из `SECURITY.md`.
- Нельзя добавлять hotkey или task-database fallback к native bridge без отдельного решения.
- Идентификаторы действий, manifest UUID и каталог пакета остаются в пространстве `com.xonika9.codex-deck`.
- Изменения renderer-интеграции требуют обновить compatibility notes и проверить на живом Codex.
- Автоматические, live-app и physical-device проверки учитываются раздельно.

## Итог решений

| Возможность | Решение | Почему |
|---|---|---|
| Явная привязка relay-команды к владельцу/host | **adopt now** | В текущем коде remote-команда проверяет наличие relay, но не подтверждает, что подключён именно захваченный `hostId`. Это узкое усиление уже существующей multi-host границы. |
| Long-press shortcuts на Agent 1-6 | **defer** | Пользовательская ценность понятна, но реализация прошла через семь последующих исправлений гонок и shutdown. Перенос требует отдельной характеристики текущего action lifecycle и физического Stream Deck. |
| macOS modifier handling | **defer** | Это зависимый backend для отложенного long-press, а не самостоятельная возможность текущего продукта. Unit-тесты подтверждают план событий, но не Accessibility, CoreGraphics и отсутствие stuck modifiers в живой системе. |
| Otty/pi integration | **defer, отдельный продуктовый выбор** | Интеграция меняет источник Agent 1-6, добавляет сторонний CLI и pi extension. В текущем виде Otty-ветка прекращает обычное обновление Codex snapshot, что конфликтует с независимым multi-host и iPhone relay. |

---

## Карта коммитов и файлов

### 1. Явная привязка relay-команды к владельцу/host

Основные коммиты:

- `fae74e7` (`feat: relay explicit thread selection safely`): добавляет `select-thread`, `sendToPinnedOwner`, server-side leases для held action и тесты relay/bridge.
- `f915b4d` (`fix: serialize relay action ownership`): передаёт ожидаемый `hostId` в relay client, связывает `ready` с конкретным WebSocket и сериализует down/up одного action slot.

Файлы-источники: `src/codex-relay-client.ts`, `src/codex-relay-server.ts`, `src/controller.ts`, `src/relay-protocol.ts`, `src/codex-micro-renderer-bridge.ts`, `test/relay.test.ts`, `test/micro-bridge.test.ts`.

Текущие точки встраивания: `src/controller.ts`, `src/codex-relay-client.ts`, `src/control-target.ts`, `src/codex-relay-server.ts`, `src/relay-protocol.ts`, `test/control-target.test.ts`, `test/relay.test.ts`.

### 2. Long-press shortcuts

Замысел и план: `28c7aa8`, `1f22c79`, `8ad3049` в `docs/superpowers/specs/2026-08-02-agent-long-press-shortcut-design.md` и `docs/superpowers/plans/2026-08-02-agent-long-press-shortcuts.md`.

Реализация и исправления:

- `3ca9bc8`: глобальная машина long-press, порог 450 ms, настройки и первичные тесты.
- `f87e83e`: release удержаний при shutdown.
- `3c80097`: устранение deadlock при отпускании во время selection.
- `97d215d`: ожидание release исчезнувшего action.
- `c6d167c`: запрет новых presses во время shutdown.
- `0aa331b`: устранение двойной очистки при исчезновении action.
- `5dee17b`: направление long press в native Codex action `ACT10_ACT11`, а не в Agent HID.
- `98c6f4e`: release активного hold перед переключением источника Agent.

Файлы-источники: `src/actions.ts`, `src/controller.ts`, `src/plugin.ts`, `src/codex-micro-renderer-bridge.ts`, `src/relay-protocol.ts`, `src/codex-relay-server.ts`, `static/property-inspector/agent.html`, `test/long-press.test.ts`, `test/actions.test.ts`, `test/relay.test.ts`.

### 3. macOS modifier handling

Основные коммиты:

- `48533c9`: локальный macOS shortcut backend и первичные тесты.
- `928a945`: сохранение modifier flags в CoreGraphics событиях.
- `5e8479d`: сохранение side-specific flags при паре left/right одного modifier.
- `ea3d2e9`: правильное снятие modifier flag до соответствующего key-up.

Файлы-источники: `src/macos-shortcut.ts`, `src/controller.ts`, `static/property-inspector/agent.html`, `test/macos-shortcut.test.ts`.

### 4. Otty/pi integration

Замысел и планы: `ea5ae36`, `a458494`, `a33f094`, `90cf2ee`, `ae870f0`, `3b06c95` в Otty/pi specs и plans под `docs/superpowers/`.

Реализация и исправления:

- `e78ee3f`: standalone pi state extension и включение её в package build.
- `9552226`: чтение Otty tabs/panes и pi state records.
- `c3fc861`: переключатель источника Agent и фокус Otty tab.
- `8ad5441`: setup/manifest changes.
- `98c6f4e`: release long-press перед сменой источника.
- `8a7479e`: нормализация `p_` в pane identifiers.
- `abd8b64`: context usage для существующего кольца.
- `da01340`: unread completion и read receipts.

Файлы-источники: `extensions/otty-pi-agent-state.ts`, `src/otty.ts`, `src/controller.ts`, `src/plugin.ts`, `src/status.ts`, `src/types.ts`, `scripts/build.mjs`, `static/property-inspector/agent.html`, `static/manifest.json`, `test/otty.test.ts`, `test/status.test.ts`, `test/ios-project.test.ts`.

---

## Решение 1: adopt now для явной relay/host привязки

### Ценность и доказательства

Текущий `DeckController.sendAgent()` фиксирует `RoutedAgentSlot` между key-down и key-up, но remote path заканчивается вызовом `sendRemote(command)`. Текущий `CodexRelayClient.send()` проверяет только открытый WebSocket и наличие какого-либо `host`; он не принимает ожидаемый `hostId`. После reconnect или замены relay endpoint команда может уйти уже не тому владельцу, который был захвачен при key-down.

`f915b4d` закрывает этот разрыв двумя независимыми мерами:

- `CodexRelayClient.send(command, expectedHostId)` сравнивает подтверждённый relay host с ожидаемым владельцем;
- сообщения принимаются только от текущего `readySocket`, а disconnect очищает `host` и `readySocket`.

Это соответствует `docs/ARCHITECTURE.md`: Agent presses маршрутизируются по стабильной паре `(hostId, threadKey)`, а last-known snapshot остаётся только display-only. Мера не расширяет relay-команды, не касается CDP listener и полезна до long-press.

### Что переносить узко

Первый срез должен перенести только owner/socket safety из `f915b4d` и необходимую обвязку в `src/controller.ts`:

1. Добавить проверку ожидаемого `hostId` в `CodexRelayClient.send()` и принимать `ready`/snapshot/health только от текущего сокета.
2. Очищать подтверждённый host при `close()`, disconnect и замене сокета.
3. Для Agent down/up отправлять remote command через helper, который сравнивает захваченного владельца с текущим local host или relay host.
4. Не менять семантику function/joystick/reasoning target: она по-прежнему управляется `HostToggle` и `src/control-target.ts`.

`select-thread` из `fae74e7` пока не нужен. Текущий short press уже проходит через `sendAgent`, а thread normalization из `eb98274` остаётся единственным источником истины. Добавить новую relay capability стоит только в будущем long-press срезе, где selection надо отделить от `ACT10_ACT11`.

### Риски, зависимости и тестовый разрыв

- Надо сохранить iPhone клиентов: необязательный аргумент `expectedHostId` относится к локальному relay client и не меняет wire protocol.
- Нельзя переписать `sendToHost()` целиком по старому diff. Текущая функция обслуживает account usage reset, nearby iPhone и новый control-target слой, которых не было в исходной точке ветвления.
- Static tests из `f915b4d` не доказывают reconnect к relay с другим `hostId`; нужен отдельный поведенческий тест с двумя последовательными server identities.
- Live multi-host проверка должна подтвердить, что down на host A, reconnect к host B и последующий up не создают action на B.

### Совместимость с переименованным форком

Срез не требует manifest, action UUID, package path, README, изображений или version bump из `crunchy/main`. Его надо реализовать вручную поверх текущего `com.xonika9.codex-deck`, не cherry-pick коммитов.

---

## Решение 2: defer long-press shortcuts

### Ценность и доказательства

Дизайн удачный для частого сценария: короткий press выбирает задачу, удержание запускает push-to-talk на владельце задачи. Он также исправляет семантическую ошибку первой версии: `5dee17b` направляет удержание в native action `ACT10_ACT11`, а не повторяет Agent HID.

Но история показывает высокую lifecycle-стоимость. После `3ca9bc8` потребовались отдельные исправления для shutdown, selection race, исчезновения action, запрета новых presses при остановке и двойной очистки. Это не косметические правки: без них возможны stuck holds, зависание остановки или release на неверном transport.

Текущий `main` дополнительно отличается от исходной базы:

- `eb98274` изменил правила renderer thread selection, поэтому public `selectThread()` надо извлечь из текущего bridge, а не копировать старую реализацию;
- controller теперь обслуживает два iPhone relay server, nearby transport, account-scoped usage и более богатый refresh lifecycle;
- `src/actions.ts` и `static/manifest.json` используют UUID переименованного форка;
- iOS уже имеет собственный long-press UI для details, но это другой жест и другой контракт. Его нельзя считать тестом физического Stream Deck hold.

### Условия возврата к возможности

Перейти к реализации можно после принятия среза relay owner safety и при наличии окна для live macOS/Windows + physical-device QA. Отдельно нужно подтвердить продуктовый default: `off` или `codex-transcription`. В `crunchy/main` default включён, что меняет поведение всех шести Agent keys сразу; безопаснее начать с opt-in `off`, пока физические проверки не завершены.

### Будущий узкий перенос

1. Сначала добавить characterization tests для текущих `AgentAction` down/up/disappear, controller stop и refresh, не меняя поведение.
2. Извлечь из текущего `CodexMicroRendererBridge` отдельный выбор thread, сохранив нормализацию `eb98274`; добавить typed `select-thread` только в аутентифицированный relay protocol.
3. Перенести state machine из конечного состояния после `c6d167c` и `97d215d`, а не из `3ca9bc8`. Сразу включить generation, pending release drain, terminal shutdown и один active hold.
4. Маршрутизировать hold через `action: ACT10_ACT11` согласно `5dee17b` и захваченный owner согласно первому срезу.
5. Добавить global settings и progress rendering отдельно. Сохранить `showContextRings` при записи settings и UUID `com.xonika9.codex-deck`.

### Обязательные проверки будущего среза

- Automated: threshold 449/450 ms, release до завершения selection, duplicate down/up, disappear, settings change, shutdown drain, 60-second lease, два Agent keys, relay reconnect с другим host, local Windows, local macOS и optional multi-host маршруты.
- Live-app: точный выбор local и remote thread на актуальном Codex после renderer changes.
- Physical device: quick tap, long hold, unplug/reload во время hold, смена host target во время hold и отсутствие stuck dictation.
- Репозиторные проверки после реализации: `npm run check`, `npm test`, `npm run validate`; release artifacts требуют `npm run audit:release`.

---

## Решение 3: defer macOS modifier handling

### Ценность и доказательства

Конечный `src/macos-shortcut.ts` из `crunchy/main` ограничивает payload числовыми keycodes 0-127 и allowlist из восьми side-specific modifiers. JXA остаётся фиксированным, а пользовательский текст не превращается в script. Отдельный detached helper сам снимает клавиши по lease, если plugin process исчезает. Это разумные локальные границы и не добавляет arbitrary shortcut в relay.

Коммиты `928a945`, `5e8479d` и `ea3d2e9` важны как единый набор. Они показывают, что исходная схема flags была неверной для modifier-only и пар left/right. Переносить только `48533c9` нельзя.

### Почему не adopt now

В текущем продукте нет самостоятельного потребителя этого backend. Он нужен только режиму `macos-shortcut` внутри отложенного long-press. Преждевременный перенос добавит JXA/CoreGraphics, Accessibility permission и `/tmp` stop-file lifecycle без доступной пользователю функции.

Есть и тестовый разрыв: `test/macos-shortcut.test.ts` проверяет validation, event plan, generated source и coalesced stop promise, но не запускает реальный `osascript`, не подтверждает Accessibility prompt и не доказывает, что Right Option, normal chord и plugin termination снимают физические modifiers.

### Будущий отдельный срез

После стабилизации Codex-transcription long-press:

1. Перенести конечную версию helper из `48533c9 + 928a945 + 5e8479d + ea3d2e9` без изменений relay protocol.
2. Оставить вызов macOS-only: на Windows mode недоступен в UI и отклоняется в runtime, но Windows-only plugin продолжает собираться и работать.
3. Проверить, что helper создаёт только user-local temporary state, release idempotent, lease bounded, а package audit не включает runtime files.
4. Только после live QA открыть режим в property inspector.

Обязательная physical/live проверка: Right Option modifier-only, left/right пары одного modifier, normal chord, release при key-up, mode change, action disappearance, Stream Deck reload, plugin termination и истечение lease. Compile или unit test не считать physical-device evidence.

---

## Решение 4: defer Otty/pi как отдельный продуктовый выбор

### Ценность и доказательства

Ветка строит аккуратный адаптер без модификации Otty.app:

- `otty tab list --json` и `otty pane list --json` дают поддерживаемую CLI-проекцию;
- standalone pi extension пишет небольшие атомарные records с mode `0600`;
- `8a7479e` нормализует реальный разрыв `p_<pane>` против `OTTY_PANE_ID`;
- context ring переиспользует существующий renderer;
- unread receipt зависит от foreground Otty + active tab и не читает prompt/response content.

### Почему это не технический hotfix

Otty меняет назначение Agent 1-6 и добавляет новый продуктовый режим, внешнюю установку extension, сторонний CLI и локальную модель read receipts. Это требует решения о поддерживаемых версиях Otty/pi, установке extension, диагностике и месте функции в Windows/macOS/multi-host продукте.

Текущая реализация `c3fc861` в режиме Otty делает ранний return из `DeckController.refreshOnce()` после чтения Otty slots. Из-за этого local Codex snapshot, health и relay публикация не обновляются обычным путём. Утверждение дизайна "other Codex actions, relay support ... are not part of Otty mode" недостаточно для текущего форка: один и тот же controller обслуживает Stream Deck, optional multi-host и два iPhone transport. Старая ветка не проверяет, что Otty на Mac не замораживает Codex state для Windows или iPhone.

Также присутствуют fork-несовместимые изменения: `8ad5441` редактирует README и `static/manifest.json` со старыми `com.simeo`/Dazer metadata, а `scripts/build.mjs` из ветки копирует extension в прежний package lineage. Эти файлы нельзя переносить целиком.

### Продуктовые вопросы до планирования реализации

- Otty заменяет Agent source локально только на одном Mac или должен появиться как отдельный host/source в объединённой модели?
- Должны ли Windows и iPhone видеть Otty tabs, и если да, какой typed snapshot/command contract это выражает?
- Кто устанавливает и обновляет `extensions/otty-pi-agent-state.ts`, какие версии Otty CLI и pi поддерживаются?
- Допустимо ли сохранять `sessionId` и `cwd`, если adapter фактически использует только pane, PID, state и timestamps? По принципу минимизации эти поля стоит удалить или отдельно обосновать.
- Как должны сосуществовать Otty unread receipts и текущая Codex session ownership/read-state модель?

### Если продуктовый выбор будет положительным

Разбить работу минимум на три независимых среза:

1. **Adapter proof, macOS-only:** CLI parser, pane normalization, stale PID filtering и focus без подключения к controller. Проверить на поддерживаемых версиях Otty/pi.
2. **Источник Agent без остановки Codex refresh:** объединить Otty polling с текущим non-overlapping refresh так, чтобы Codex snapshots, health, iPhone и multi-host продолжали обновляться. Переключатель должен быть opt-in и локальным, пока relay contract не расширен.
3. **Context/unread:** только после стабильного tab mapping добавить context percentage и минимизированные receipts. Foreground detection failure не должен помечать completion прочитанным.

Для каждого среза нужны Windows-only regression, macOS-only live Otty/pi, optional multi-host relay и iPhone transport checks. Otty live-app evidence и физический Stream Deck evidence отчётны отдельно.

---

## Рекомендуемая последовательность

### Срез A. Relay owner/socket safety - принять сейчас

Зависимости: нет новых product decisions и нет wire-protocol change.

Файлы: `src/codex-relay-client.ts`, `src/controller.ts`, `test/relay.test.ts`; при необходимости точечного helper-теста `test/control-target.test.ts`.

Проверки:

- remote command принимается только текущим authenticated/ready socket;
- expected `hostId` mismatch отклоняется до отправки;
- stale socket messages не меняют host/snapshot;
- Agent up не уходит на заменившийся remote host;
- single-host local Windows и macOS paths не требуют relay config;
- после реализации проходят `npm run check`, `npm test`, `npm run validate`.

### Срез B. Codex-transcription long press - оставить в очереди

Зависимости: срез A, подтверждённый default mode, доступ к физическому Stream Deck и live local/remote Codex.

Файлы-кандидаты: `src/actions.ts`, `src/controller.ts`, `src/plugin.ts`, `src/codex-micro-renderer-bridge.ts`, `src/relay-protocol.ts`, `src/codex-relay-server.ts`, `static/property-inspector/agent.html`, `test/long-press.test.ts`, `test/actions.test.ts`, `test/relay.test.ts`, `test/micro-bridge.test.ts`.

Переносить вручную по финальным инвариантам всей серии, не cherry-pick `3ca9bc8`.

### Срез C. macOS shortcut backend - после B

Зависимости: стабильная общая state machine и подтверждённый UX режима.

Файлы-кандидаты: новый `src/macos-shortcut.ts`, `src/controller.ts`, `static/property-inspector/agent.html`, новый `test/macos-shortcut.test.ts`.

Не расширять relay payload и не показывать режим на Windows.

### Срез D. Otty/pi - только после отдельного продуктового решения

Зависимости: ответы на вопросы о source model, transport visibility, installation/support contract и data minimization.

Начинать с adapter proof. Не смешивать Otty с long-press, modifier handling, package rename или release assets.

---

## Явно вне scope

- Повторный анализ или перенос prefixed-thread selection из `431a349`; текущая реализация `eb98274` остаётся канонической.
- Любой wholesale cherry-pick из `crunchy/main`.
- Изменение production-кода в рамках этого аудита.
- Изменение README, README.ru, hero/usage preview, MIC/PR10 файлов, plugin icons, package versions или release bundles.
- Перенос старых `com.simeo.codex-deck` UUID, Dazer metadata или старого dist path.
- Публикация Otty/pi как поддерживаемой функции до отдельного продуктового решения.
- Утверждение live-app или physical-device результата на основании исходных unit tests.

## Общие риски

- `crunchy/main` содержит последовательные исправления одной и той же lifecycle логики; выбор раннего коммита воспроизводит уже найденный дефект.
- Текущий controller шире исходного: nearby iPhone, mobile relay, account usage и session ownership повышают риск при копировании старых методов целиком.
- Renderer API внутренний и нестабильный. Новый public selection path должен переиспользовать текущую нормализацию `eb98274` и получить compatibility note.
- Relay held-action leases расширяют server state и должны быть доказаны для нескольких authenticated clients, disconnect, timeout и shutdown.
- JXA/CoreGraphics требует Accessibility и живого macOS доказательства; unit plan событий не исключает stuck modifier.
- Otty CLI и pi extension представляют новый внешний compatibility contract, которого сейчас нет в документации поддержки.

## Проверка самого аудита

Документ основан на статическом чтении refs и diff. Production-код не менялся, ветки/индекс/коммиты не создавались, полный набор тестов не запускался. Это допустимое исключение для knowledge-work: результат проверяется трассировкой решений к commit/file diff, текущей архитектуре и security invariants, а не выполнением будущих функций.
