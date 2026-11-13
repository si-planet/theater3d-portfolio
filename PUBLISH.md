# 공개 소스와 웹 데모 관리

대상 공개 저장소: `https://github.com/si-planet/theater3d-portfolio`

정제된 파일만 새 이력으로 올리는 절차입니다. 비공개 저장소의 브랜치나 Git 이력을 그대로 옮기지 않습니다. 아래 명령은 저장소 소유자가 최초 게시하거나 이후 수정할 때 사용합니다.

2026-11-13 최초 공개 게시와 대표 기능 확인을 완료했습니다. 현재 주소는 https://si-planet.github.io/theater3d-portfolio/ 입니다. 아래 최초 게시 절차는 재현 안내이며, 이후 작업은 마지막 절의 기능 브랜치·PR 절차로 이어갑니다. 운영 자료나 비공개 이력은 가져오지 않습니다.

## 1. 최초 게시할 파일 확인

공개용 폴더의 파일만 새 빈 폴더에 복사합니다. `.git`, `.env`, 실제 사진·도면·극장 데이터, 계정, 운영 설정, `node_modules`는 복사하지 않습니다. [FILE_ALLOWLIST.json](FILE_ALLOWLIST.json)과 공개할 파일 목록이 일치하는지 먼저 검사합니다.

```sh
python3 -B tests/audit-safe-export.py
node tests/synthetic-fixture.mjs
node tests/portfolio-boundaries.mjs
```

Windows에서는 `python3`를 `py -3`로 바꿀 수 있습니다. Markdown 문서도 GitHub 웹, Windows, macOS에서 같은 내용으로 열립니다.

## 2. 빈 공개 저장소에 새 이력으로 올리기

**첫 커밋이 없는 경우에만 실행합니다.** 이미 공개 소스가 올라갔다면 아래의 ‘이후 변경’ 절차를 사용합니다.

복사한 공개용 폴더에서:

```sh
git init -b main
git add .
git diff --cached --stat
git diff --cached --check
git commit -m "Initial theater3D portfolio demo"
git rev-list --count HEAD
```

최초 커밋 수는 `1`이어야 합니다. GitHub의 대상 저장소가 빈 저장소인지 확인한 다음 연결합니다.

```sh
git remote add origin https://github.com/si-planet/theater3d-portfolio.git
git remote -v
git push -u origin main
```

기존 비공개 저장소의 공개 전환, 비공개 브랜치의 push·merge, 강제 push는 이 절차에 포함하지 않습니다.

## 3. GitHub Pages 켜기

1. 공개 저장소의 **Settings → Pages**를 엽니다.
2. Source에서 **Deploy from a branch**를 선택합니다.
3. Branch는 **main**, Folder는 **/(root)**로 지정하고 저장합니다.
4. Actions의 Pages 배포가 완료되면 **Visit site**에서 실제 주소를 확인합니다.
5. 실주소 확인이 끝난 뒤 README와 GitHub About의 Website에 주소를 등록합니다.

예상 주소는 `https://si-planet.github.io/theater3d-portfolio/`입니다. 배포 성공과 실제 접속을 확인하기 전에는 공개 데모가 열려 있다고 표시하지 않습니다.

빌드하지 않은 정적 파일을 게시하므로 `.nojekyll`을 포함합니다. GitHub Free의 공개 저장소에서 Pages를 사용할 수 있으며 별도 유료 서비스나 도메인 구매를 요구하지 않습니다. branch 게시도 GitHub의 Pages 배포 workflow를 통해 처리됩니다. [GitHub 공식 설정 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 4. 게시 후 확인

| 확인 항목 | 기대 동작 |
| --- | --- |
| 저장소 루트 주소 | 가상 극장 1개와 18좌석을 표시 |
| `index.html` 직접 접속 | 동일한 데모를 표시 |
| 쿼리·해시가 있는 루트 URL 새로고침 | 자산·JSON 경로 오류 없이 시작 |
| 좌석 선택·보기 전환 | 좌석 시점·단면·전체 3D가 선택에 맞게 변경 |
| 인물·구조물 편집 | 위치·크기 변경이 화면에 반영 |
| 사진 비교·배치 보관 | 기본 좌석의 합성 사진 투영·잠금, 로컬 파일 처리와 저장 범위가 안내와 일치 |
| 사진 보관본 삭제 | 합성 시험 사진을 보관한 뒤 삭제 확인·취소·다른 좌석으로 이동을 확인하고, 삭제 시 해당 브라우저 보관본만 제거되는지 확인 |
| 좌석 의견 체험 | 브라우저 메모의 저장·새로고침 복원·삭제 |
| 작은 화면 | 주요 조작에 접근할 수 있고 화면 밖으로 밀리지 않음 |

내장 브라우저에서 화면 크기 변경 후 전체 페이지 캡처 시 무대가 검게 잡힌 사례가 있었습니다. Chrome의 좁은 화면 → 데스크톱 → 전체 페이지 캡처 → 크기 초기화 재검사에서는 재현되지 않았습니다. 원인은 미확정이므로 캡처 환경의 문제라고 단정하지 않으며, 게시 후에도 화면 크기 변경과 무대 렌더링을 확인합니다.

앱은 단일 문서입니다. `/admin` 같은 임의 하위 URL이나 서버 API는 제공하지 않습니다. 실제 휴대폰 검수가 끝나지 않았다면 브라우저의 좁은 화면 검사와 구분해 기록합니다.

## 검사·CI·배포의 차이

| 단계 | 하는 일 | 그 결과만으로 확인되지 않는 것 |
| --- | --- | --- |
| 로컬 검사 | 모델 계산·정제 범위·경로 검사 | 공개 주소의 최신 반영 여부 |
| 사용자 정의 CI | push·PR마다 같은 검사 자동 실행 | 실제 화면의 사용성과 실휴대폰 동작 |
| Pages 배포 | 지정 브랜치의 파일을 웹 주소에 게시 | 모든 기능의 정상 동작 |
| 배포 후 검수 | 실주소의 화면·기능·새로고침 확인 | 운영 서비스의 인증·DB 동작 |

별도의 사용자 정의 CI workflow는 이 묶음에 포함하지 않았습니다. Pages의 게시 workflow와 제품 기능을 검사하는 CI는 역할이 다릅니다. 추가 CI를 붙이더라도 위 정적 검사 명령부터 반복하도록 구성할 수 있습니다.

## 이후 변경과 복구

1. 공개 저장소의 최신 `main`에서 기능별 브랜치를 만듭니다.
2. 비공개 제품의 변경 중 공개 가능한 코드만 대조해 반영합니다. 실제 자료나 운영 설정을 함께 복사하지 않습니다.
3. 검사 결과와 변경 범위를 정리하고 커밋·PR로 검토합니다.
4. `main`에 통합한 뒤 Pages의 배포 커밋과 실주소를 확인합니다.
5. 잘못된 변경은 해당 **공개 커밋을 revert**하는 새 커밋으로 복구합니다.

최초 게시 뒤에는 공개 저장소를 clone하여 그 이력을 이어갑니다. 매번 새 저장소를 만들거나 원본 저장소의 이력을 끌어오지 않습니다. 새 작업의 시작 예시는 다음과 같습니다.

```sh
git clone https://github.com/si-planet/theater3d-portfolio.git
cd theater3d-portfolio
git switch main
git pull --ff-only
git switch -c fix/demo-interaction
```

이미 clone한 폴더가 있다면 첫 두 줄은 생략합니다. 수정 후에는 해당 기능의 검사와 공개 범위 검사를 실행하고, 기능 브랜치를 push해 PR로 통합합니다. Pages가 게시한 커밋과 `main`의 커밋을 대조하고, 브라우저에서 실제 반영까지 확인한 뒤 README·검수 결과를 갱신합니다. 소스 push만으로 배포 검수가 끝난 것으로 표시하지 않습니다.

`LICENSE`와 `THIRD_PARTY_NOTICES.md`를 유지하세요. 새 화면·자산·문서를 추가할 때는 합성 자료인지, 배포 권한이 있는지, 실제 자료가 섞이지 않았는지 함께 확인합니다. 공개된 소스를 다시 비공개로 바꾸더라도 이미 생성된 사본이나 fork가 없어지는 것은 아닙니다. [GitHub 라이선스 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
