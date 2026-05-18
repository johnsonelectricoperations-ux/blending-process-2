// 분말 검사 시스템 - 메인 JavaScript

// API Base URL
const API_BASE = '';

// PDF.js worker 설정
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Millsheet 상태
let millsheetPdfDoc      = null;
let millsheetSelectedPages = [];
let millsheetFile        = null;

// 현재 로그인 사용자 정보
let currentUserId = '';
let currentUserName = '';
let currentAllowedMenus = [];
let currentIsProgramAdmin = false;
let currentRole = 'program_admin'; // 기존 코드 호환용

// 라벨 데이터 캐시 (프린터 에이전트 전송용)
let _labelDataCache = [];

function setMenuByRole() {
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        const page = item.getAttribute('data-page');
        const allowed = currentAllowedMenus.includes(page);
        if (allowed) {
            item.style.opacity = '1';
            item.style.pointerEvents = 'auto';
            item.style.cursor = 'pointer';
        } else {
            item.style.opacity = '0.35';
            item.style.pointerEvents = 'none';
            item.style.cursor = 'not-allowed';
        }
        item.style.display = 'flex';
    });
    // 프로그램관리자 전용 탭 표시
    const tabPerms = document.getElementById('adminTabPermissions');
    const tabUserMgmt = document.getElementById('adminTabUserMgmt');
    const tabScanRules = document.getElementById('adminTabScanRules');
    const tabBotSettings = document.getElementById('adminTabBotSettings');
    if (tabPerms) tabPerms.style.display = currentIsProgramAdmin ? 'inline-flex' : 'none';
    if (tabUserMgmt) tabUserMgmt.style.display = currentIsProgramAdmin ? 'inline-flex' : 'none';
    if (tabScanRules) tabScanRules.style.display = currentIsProgramAdmin ? 'inline-flex' : 'none';
    if (tabBotSettings) tabBotSettings.style.display = currentIsProgramAdmin ? 'inline-flex' : 'none';
}

// ============================================
// 스플래시(대문) 화면 → 로딩 → 메인화면 전환
// ============================================
(function() {
    // 사이드바+메인 콘텐츠를 초기에 숨김
    const style = document.createElement('style');
    style.textContent = '.sidebar, .main-content { display: none !important; }';
    style.id = 'splash-hide-main';
    document.head.appendChild(style);
})();

function startApp() {
    const splashLoading = document.getElementById('splashLoading');
    const splashStartBtn = document.getElementById('splashStartBtn');

    splashStartBtn.style.display = 'none';
    splashLoading.style.display = 'flex';

    const readyCheck = new Promise(resolve => {
        if (document.readyState === 'complete') resolve();
        else window.addEventListener('load', resolve);
    });

    readyCheck.then(() => {
        setTimeout(() => {
            const splash = document.getElementById('splashScreen');
            splash.classList.add('fade-out');
            setTimeout(() => splash.remove(), 500);

            // 스플래시 후 로그인 오버레이 표시
            const overlay = document.getElementById('loginOverlay');
            if (overlay) overlay.style.display = 'flex';

            // Enter 키 로그인
            const pwInput = document.getElementById('loginPassword');
            if (pwInput) {
                pwInput.addEventListener('keydown', e => {
                    if (e.key === 'Enter') handleLogin();
                });
            }
            const idInput = document.getElementById('loginUserId');
            if (idInput) {
                idInput.addEventListener('keydown', e => {
                    if (e.key === 'Enter') handleLogin();
                });
            }
        }, 800);
    });
}

async function handleLogin() {
    const userId = (document.getElementById('loginUserId')?.value || '').trim();
    const password = document.getElementById('loginPassword')?.value || '';
    const errorEl = document.getElementById('loginError');

    if (!userId || !password) {
        if (errorEl) errorEl.textContent = 'ID와 비밀번호를 입력하세요.';
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, password })
        });
        const data = await resp.json();

        if (!data.success) {
            if (errorEl) errorEl.textContent = data.message || '로그인 실패';
            return;
        }

        // 로그인 성공
        currentUserId = data.userId;
        currentUserName = data.name;
        currentAllowedMenus = data.allowedMenus || [];
        currentIsProgramAdmin = data.isProgramAdmin || false;
        currentRole = data.isProgramAdmin ? 'program_admin' : data.userId;

        // 오버레이 닫기 + 메인 보이기
        const overlay = document.getElementById('loginOverlay');
        if (overlay) overlay.style.display = 'none';
        const hideStyle = document.getElementById('splash-hide-main');
        if (hideStyle) hideStyle.remove();

        setMenuByRole();

        // 첫 번째 허용 메뉴로 이동
        const first = currentAllowedMenus[0] || 'dashboard';
        showPage(first);

    } catch (err) {
        if (errorEl) errorEl.textContent = '서버 오류: ' + err.message;
    }
}

// 현재 검사 데이터
let currentInspection = null;
let currentItems = [];
let currentSavedValues = {}; // 저장된 측정값
// 임시 판정 결과 저장
let pendingResults = {};

// 안전한 이벤트 리스너 추가 헬퍼 함수
function safeAddEventListener(elementId, eventType, handler) {
    const element = document.getElementById(elementId);
    if (element) {
        element.addEventListener(eventType, handler);
        return true;
    }
    return false;
}

// 한국어 텍스트 매핑 함수
function t(key) {
    const ko = {
        // 사이드바
        appTitle: '배합공정 관리시스템',
        navDashboard: '대시보드',
        navIncoming: '수입검사',
        navMixing: '배합검사',
        navStartInspection: '새 검사 시작',
        navSearchResults: '검사결과 조회',
        navAdmin: '관리자 모드',

        // 대시보드
        dashboardTitle: '대시보드',
        ongoingInspections: '진행중인 검사',
        noOngoingInspections: '진행중인 검사가 없습니다',
        powderName: '분말명',
        lotNumber: 'LOT번호',
        inspectionType: '검사타입',
        inspector: '검사자',
        progress: '진행률',
        action: '작업',
        continue: '이어하기',
        category: '검사구분',
        incoming: '수입검사',
        mixing: '배합검사',
        all: '전체',

        // 검사 관련
        inspectionTime: '검사시간',
        finalResult: '최종결과',
        detail: '상세',
        view: '보기',
        noResults: '검색 결과가 없습니다',
        average: '평균',
        result: '결과',
        inspectionDetails: '검사 항목 상세',
        particleSize: '입도분석',

        // 검사 항목
        flowRate: '유동도',
        apparentDensity: '겉보기밀도',
        cContent: 'C함량',
        cuContent: 'Cu함량',
        moisture: '수분도',
        ash: '회분도',
        sinterChangeRate: '소결변화율',
        sinterStrength: '소결강도',
        formingStrength: '성형강도',
        formingLoad: '성형하중',

        // 삭제 확인
        deleteInspectionConfirm: '진행중인 검사를 삭제하시겠습니까?',
        deleteSuccess: '삭제되었습니다',
        deleteError: '삭제 실패',
        delete: '삭제',

        // 관리자
        noPowders: '등록된 분말이 없습니다',
        selectPowderPlaceholder: '분말을 선택하세요',
        meshSize: 'Mesh Size',
        minValue: '최소값',
        maxValue: '최대값',
        noParticleSpecs: '등록된 입도분석 규격이 없습니다',
        addParticleSpec: '입도분석 규격 추가',
        editParticleSpec: '입도분석 규격 수정',
        edit: '수정',
        inspectorName: '검사자 이름',
        noInspectors: '등록된 검사자가 없습니다',
        operatorName: '작업자 이름',
        noOperators: '등록된 작업자가 없습니다',
        addPowder: '새 분말 추가',
        editPowder: '분말 수정',
        selectPlaceholder: '선택하세요',

        // Recipe 관련
        noProducts: '등록된 제품이 없습니다',
        productCode: '제품 코드',
        ratio: '비율',
        tolerance: '허용 오차',
        toleranceMinus: '최소 -',
        tolerancePlus: '최대 +',
        totalRatio: '합계',
        addNewProduct: '+ 새 제품 추가',
        editProduct: '제품 수정',

        // 배합 작업
        calculatedWeight: '계산된 중량',

        // 라벨/바코드
        companyName: 'Johnson Electric Operations',
        labelPack: 'Pack',
        labelWeight: '중량',
        labelDate: '작업날짜',
        printLabel: '인쇄'
    };
    return ko[key] || key;
}

        // ============================================
        // 준비중 메뉴 안내
        // ============================================
        function showComingSoon(menuName) {
            const message = `"${menuName}" 기능은 현재 개발 중입니다.\n\n향후 업데이트에서 제공될 예정입니다.`;
            alert(message);
        }

        // ============================================
        // 페이지 전환
        // ============================================
        function showPage(pageName) {
            if (pageName === 'admin') {
                showAdminPageDirect();
                return;
            }

            // 내부 하위 페이지는 별도 권한 체크 없이 허용
            const subPages = ['inspection', 'detail', 'auto-input'];
            if (!subPages.includes(pageName) && !currentAllowedMenus.includes(pageName)) {
                return;
            }

            // 관리자 인라인 편집 모드 취소 (페이지 전환 시)
            cancelInlineEdit();

            // 대시보드 자동 갱신 타이머 정리 (다른 페이지 이동 시)
            if (pageName !== 'dashboard' && dashboardRefreshTimer) {
                clearInterval(dashboardRefreshTimer);
                dashboardRefreshTimer = null;
            }

            // 바코드 라벨 패널 숨기기 (페이지 전환 시)
            if (pageName !== 'auto-input') {
                const labelPanel = document.getElementById('labelPanel');
                if (labelPanel) {
                    labelPanel.style.display = 'none';
                    labelPanel.setAttribute('aria-hidden', 'true');
                }
            }

            // 페이지 전환
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            document.getElementById(pageName).classList.add('active');

            // 네비게이션 active 상태 업데이트
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const activeNav = document.querySelector(`.nav-item[data-page="${pageName}"]`);
            if (activeNav) {
                activeNav.classList.add('active');
            }

            // 페이지별 초기화
            if (pageName === 'dashboard') {
                loadDashboard();
                loadIncompleteInspections();
            } else if (pageName === 'incoming') {
                loadPowderList('incoming');
                loadInspectorList('incoming');
                loadIncomingIncompleteInspections();

                // 수입검사 폼 초기화
                const incomingForm = document.getElementById('incomingForm');
                if (incomingForm) {
                    incomingForm.reset();
                    // 검사일을 오늘 날짜로 재설정
                    const incomingDateInput = document.getElementById('incomingInspectionDate');
                    if (incomingDateInput) {
                        const today = new Date().toISOString().split('T')[0];
                        incomingDateInput.value = today;
                    }
                }
            } else if (pageName === 'mixing') {
                // mixing 페이지는 완료된 배합작업 목록만 보여줌
                loadMixingPage();
            } else if (pageName === 'blending') {
                // hide form initially so only orders list shows
                hideBlendingForm();
                loadBlendingPage();
            } else if (pageName === 'search') {
                loadPowderListForSearch();
            } else if (pageName === 'blending-log') {
                loadMixingPowderListForFilter();

                // 작업완료일 초기값 설정 (오늘 날짜)
                const today = new Date().toISOString().split('T')[0];
                const dateFromEl = document.getElementById('filterCompletedDateFrom');
                const dateToEl = document.getElementById('filterCompletedDateTo');
                if (dateFromEl && !dateFromEl.value) dateFromEl.value = today;
                if (dateToEl && !dateToEl.value) dateToEl.value = today;

                loadBlendingWorks();
            } else if (pageName === 'blending-orders') {
                loadBlendingOrdersPage();
            } else if (pageName === 'traceability') {
                // 추적성 조회 페이지 초기화
                const resultsDiv = document.getElementById('traceabilityResults');
                if (resultsDiv) {
                    resultsDiv.innerHTML = '';
                }
                loadTraceabilityPowderList();
            }
        }

        // ============================================
        // 관리자 페이지 진입
        // ============================================
        function showAdminPageDirect() {
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            document.getElementById('admin').classList.add('active');

            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const activeNav = document.querySelector(`.nav-item[data-page="admin"]`);
            if (activeNav) {
                activeNav.classList.add('active');
            }

            // 관리자 페이지 로드
            loadAdminPage();
        }

        // ============================================
        // 관리자 페이지: 탭 전환
        // ============================================
        function showAdminTab(tabName) {
            // 인라인 편집 모드 취소 (탭 전환 시)
            cancelInlineEdit();

            // 탭 버튼 active 상태 변경
            document.querySelectorAll('.admin-tab').forEach(tab => {
                tab.classList.remove('active');
            });
            event.target.closest('.admin-tab').classList.add('active');

            // 탭 콘텐츠 전환
            document.querySelectorAll('.admin-tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}-tab`).classList.add('active');

            if (tabName === 'scan-rules') loadScanRulesTab();
            if (tabName === 'bot-settings') loadBotSettingsForm();
        }

        async function loadScanRulesTab() {
            const container = document.getElementById('scanRulesTableContainer');
            if (!container) return;
            container.innerHTML = '<div style="color:#888; padding:12px;">로딩 중...</div>';
            try {
                const resp = await fetch(`${API_BASE}/api/admin/powder-spec`);
                const data = await resp.json();
                if (!data.success || !data.data.length) {
                    container.innerHTML = '<div style="color:#888; padding:12px;">등록된 분말이 없습니다.</div>';
                    return;
                }
                let html = `<table style="width:100%; border-collapse:collapse; font-size:0.95em;">
                    <thead>
                        <tr style="background:#1E1E1E;">
                            <th style="padding:10px 14px; text-align:left; border:1px solid #333;">분말명</th>
                            <th style="padding:10px 14px; text-align:center; border:1px solid #333;">구분</th>
                            <th style="padding:10px 14px; text-align:center; border:1px solid #333; width:160px;">스캔 LOT 위치</th>
                            <th style="padding:10px 14px; text-align:center; border:1px solid #333; width:120px;">저장</th>
                        </tr>
                    </thead>
                    <tbody>`;
                data.data.forEach(spec => {
                    const pos = spec.scan_lot_position || 0;
                    const catLabel = spec.category === 'mixing' ? '배합분말' : '수입분말';
                    html += `<tr style="border-bottom:1px solid #333;">
                        <td style="padding:10px 14px; border:1px solid #333; font-weight:600;">${spec.powder_name}</td>
                        <td style="padding:10px 14px; border:1px solid #333; text-align:center; color:#A0A0A0;">${catLabel}</td>
                        <td style="padding:10px 14px; border:1px solid #333; text-align:center;">
                            <input type="number" min="0" max="10" value="${pos}"
                                id="scanPos_${spec.id}"
                                style="width:70px; padding:5px; border:1px solid #555; border-radius:4px; text-align:center; background:#2A2A2A; color:#E8E8E8;">
                            <span style="color:#888; font-size:0.82em; margin-left:6px;">번째 단어</span>
                        </td>
                        <td style="padding:10px 14px; border:1px solid #333; text-align:center;">
                            <button class="btn secondary" style="padding:5px 14px; font-size:0.85em;"
                                onclick="saveScanLotPosition(${spec.id}, '${spec.powder_name}')">저장</button>
                        </td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                container.innerHTML = html;
            } catch (e) {
                container.innerHTML = `<div style="color:#EF5350; padding:12px;">오류: ${e.message}</div>`;
            }
        }

        async function saveScanLotPosition(specId, powderName) {
            const input = document.getElementById(`scanPos_${specId}`);
            if (!input) return;
            const pos = parseInt(input.value) || 0;
            try {
                // 현재 spec 전체를 가져와서 scan_lot_position만 업데이트
                const getResp = await fetch(`${API_BASE}/api/admin/powder-spec`);
                const getData = await getResp.json();
                const spec = getData.data.find(s => s.id === specId);
                if (!spec) { alert('분말 정보를 찾을 수 없습니다.'); return; }

                const resp = await fetch(`${API_BASE}/api/admin/powder-spec/${specId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...spec, scan_lot_position: pos })
                });
                const result = await resp.json();
                if (result.success) {
                    // 캐시 갱신
                    scanLotPositionCache[powderName] = pos;
                    alert(`${powderName} 저장 완료 (위치: ${pos === 0 ? '전체 사용' : pos + '번째 단어'})`);
                } else {
                    alert('저장 실패: ' + (result.message || ''));
                }
            } catch (e) {
                alert('오류: ' + e.message);
            }
        }

        // 분말 관리 탭 : 수입 / 배합 분말을 분리하여 같은 컨텐츠를 재사용
        let powderSpecMode = 'incoming';

        function showPowderManagement(mode) {
            // mode: 'incoming' or 'mixing'
            powderSpecMode = mode;

            // 인라인 편집 모드 취소 (분말 탭 전환 시)
            cancelInlineEdit();

            // 폼이 열려있으면 닫기
            hidePowderForm();

            // 탭 버튼 처리 (active 토글)
            // 먼저 모든 admin-tab 버튼의 active 클래스 제거
            document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active'));
            // 그 다음 선택된 탭만 active 추가
            if (mode === 'incoming') document.getElementById('adminTabIncoming').classList.add('active');
            else document.getElementById('adminTabMixing').classList.add('active');

            // 관리자 컨텐츠는 기존 powder-spec-tab 사용
            document.querySelectorAll('.admin-tab-content').forEach(content => content.classList.remove('active'));
            document.getElementById('powder-spec-tab').classList.add('active');

            // 로드 및 필터링
            loadPowderSpecs(mode);
        }

        // ============================================
        // 대시보드: 진행중 검사 목록
        // ============================================
        async function loadIncompleteInspections() {
            try {
                const response = await fetch(`${API_BASE}/api/incomplete-inspections`);
                const data = await response.json();

                const listDiv = document.getElementById('incompleteList');

                if (data.success && data.data.length > 0) {
                    let html = `<table><tr><th>${t('category')}</th><th>${t('powderName')}</th><th>${t('lotNumber')}</th><th>${t('inspectionType')}</th><th>${t('inspector')}</th><th>${t('progress')}</th><th>${t('action')}</th></tr>`;

                    data.data.forEach(item => {
                        const categoryBadge = item.category === 'incoming'
                            ? `<span class="badge" style="background: #F07D00;">${t('incoming')}</span>`
                            : `<span class="badge" style="background: #F07D00;">${t('mixing')}</span>`;

                        html += `
                            <tr>
                                <td>${categoryBadge}</td>
                                <td>${item.powder_name}</td>
                                <td>${item.lot_number}</td>
                                <td>${item.inspection_type}</td>
                                <td>${item.inspector}</td>
                                <td>
                                    <button class="btn" onclick="continueInspection('${item.powder_name}', '${item.lot_number}', '${item.category}')" style="margin-right: 5px;">${t('continue')}</button>
                                    <button class="btn danger" onclick="deleteIncompleteInspection('${item.powder_name}', '${item.lot_number}')">${t('delete')}</button>
                                </td>
                            </tr>
                        `;
                    });

                    html += '</table>';
                    listDiv.innerHTML = html;
                } else {
                    listDiv.innerHTML = `<div class="empty-message">${t('noOngoingInspections')}</div>`;
                }
            } catch (error) {
                document.getElementById('incompleteList').innerHTML = `<div class="empty-message">오류: ${error.message}</div>`;
            }
        }

        // 진행중인 검사 삭제
        async function deleteIncompleteInspection(powderName, lotNumber) {
            if (!confirm(t('deleteInspectionConfirm'))) {
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/api/delete-incomplete-inspection/${encodeURIComponent(powderName)}/${encodeURIComponent(lotNumber)}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    alert(t('deleteSuccess'));
                    loadIncompleteInspections();  // 목록 새로고침
                    loadIncomingIncompleteInspections(); // 수입검사 페이지 목록도 새로고침
                } else {
                    alert(t('deleteError') + ': ' + data.message);
                }
            } catch (error) {
                alert(t('deleteError') + ': ' + error.message);
            }
        }

        // 수입검사 페이지: 진행 중인 검사 목록 (수입검사만 표시)
        async function loadIncomingIncompleteInspections() {
            try {
                const response = await fetch(`${API_BASE}/api/incomplete-inspections`);
                const data = await response.json();

                const listDiv = document.getElementById('incomingIncompleteList');
                if (!listDiv) return;

                // 수입검사만 필터링
                const incomingInspections = data.success && data.data
                    ? data.data.filter(item => item.category === 'incoming')
                    : [];

                if (incomingInspections.length > 0) {
                    let html = `<table><tr><th>검사일</th><th>${t('powderName')}</th><th>${t('lotNumber')}</th><th>${t('inspectionType')}</th><th>${t('inspector')}</th><th>${t('progress')}</th><th>${t('action')}</th></tr>`;

                    incomingInspections.forEach(item => {
                        // 진행률 계산: completedItems와 totalItems 배열 사용
                        const completedCount = (item.completedItems && item.completedItems.length) || 0;
                        const totalCount = (item.totalItems && item.totalItems.length) || 0;
                        const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

                        const progressBar = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="flex: 1; background: #333; border-radius: 10px; height: 20px; overflow: hidden;">
                                    <div style="width: ${progressPercent}%; background: #4CAF50; height: 100%; transition: width 0.3s;"></div>
                                </div>
                                <span style="font-size: 12px; font-weight: 600;">${progressPercent}%</span>
                            </div>
                        `;

                        // 검사일 포맷
                        const inspectionDate = item.inspection_date || '-';

                        html += `
                            <tr>
                                <td>${inspectionDate}</td>
                                <td>${item.powder_name}</td>
                                <td>${item.lot_number}</td>
                                <td>${item.inspection_type}</td>
                                <td>${item.inspector}</td>
                                <td>${progressBar}</td>
                                <td>
                                    <button class="btn" onclick="continueInspection('${item.powder_name}', '${item.lot_number}', '${item.category}')" style="margin-right: 5px;">검사 이어하기</button>
                                    <button class="btn danger" onclick="deleteIncompleteInspection('${item.powder_name}', '${item.lot_number}')">삭제</button>
                                </td>
                            </tr>
                        `;
                    });

                    html += '</table>';
                    listDiv.innerHTML = html;
                } else {
                    listDiv.innerHTML = `<div class="empty-message">진행 중인 검사가 없습니다</div>`;
                }
            } catch (error) {
                const listDiv = document.getElementById('incomingIncompleteList');
                if (listDiv) {
                    listDiv.innerHTML = `<div class="empty-message">오류: ${error.message}</div>`;
                }
            }
        }

        // ============================================
        // 검사 시작
        // ============================================
        async function loadPowderList(category = null) {
            try {
                const url = category
                    ? `${API_BASE}/api/powder-list?category=${category}`
                    : `${API_BASE}/api/powder-list`;
                const response = await fetch(url);
                const data = await response.json();

                const selectId = category ? `${category}PowderName` : 'powderName';
                const select = document.getElementById(selectId);
                if (!select) return;

                select.innerHTML = '<option value="">선택하세요</option>';

                if (data.success) {
                    data.data.forEach(powder => {
                        const option = document.createElement('option');
                        option.value = powder;
                        option.textContent = powder;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                alert('분말 목록 로딩 실패: ' + error.message);
            }
        }

        async function loadInspectorList(category = null) {
            try {
                const response = await fetch(`${API_BASE}/api/inspector-list`);
                const data = await response.json();

                const selectId = category ? `${category}Inspector` : 'inspector';
                const select = document.getElementById(selectId);
                if (!select) return;

                select.innerHTML = '<option value="">선택하세요</option>';

                if (data.success) {
                    data.data.forEach(inspector => {
                        const option = document.createElement('option');
                        option.value = inspector;
                        option.textContent = inspector;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                alert('검사자 목록 로딩 실패: ' + error.message);
            }
        }

        // 수입검사 폼 처리
        const incomingFormElement = document.getElementById('incomingForm');

        // ============================================
        // Millsheet PDF 업로드 / 페이지 선택
        // ============================================

        async function onMillsheetFileSelected(input) {
            const file = input.files[0];
            if (!file) return;
            millsheetFile = file;
            millsheetSelectedPages = [];
            document.getElementById('millsheetFileName').textContent = file.name;
            document.getElementById('millsheetClearBtn').style.display = 'inline-block';
            document.getElementById('millsheetUploadStatus').textContent = '';

            const arrayBuffer = await file.arrayBuffer();
            try {
                millsheetPdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
                await renderMillsheetThumbnails();
                document.getElementById('millsheetPageContainer').style.display = 'block';
            } catch (e) {
                alert('PDF 파일을 열 수 없습니다: ' + e.message);
            }
        }

        let millsheetPreviewCurrentPage = 1;

        async function renderMillsheetThumbnails() {
            const container = document.getElementById('millsheetThumbnails');
            container.innerHTML = '<span style="color:#A0A0A0;font-size:0.85em;">페이지 로딩 중...</span>';
            const numPages = millsheetPdfDoc.numPages;
            container.innerHTML = '';
            for (let i = 1; i <= numPages; i++) {
                const page = await millsheetPdfDoc.getPage(i);
                const vp = page.getViewport({ scale: 0.25 });
                const canvas = document.createElement('canvas');
                canvas.width  = vp.width;
                canvas.height = vp.height;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

                const wrapper = document.createElement('div');
                wrapper.id = `millsheetThumb_${i}`;
                wrapper.dataset.page = i;
                wrapper.style.cssText = 'cursor:pointer;border:3px solid #444;border-radius:6px;padding:4px;text-align:center;background:#222;position:relative;';

                const lbl = document.createElement('div');
                lbl.textContent = `${i}페이지`;
                lbl.style.cssText = 'font-size:0.72em;color:#888;margin-top:3px;';

                // 선택 상태 뱃지
                const badge = document.createElement('div');
                badge.id = `millsheetBadge_${i}`;
                badge.style.cssText = 'display:none;position:absolute;top:4px;right:4px;background:#1976D2;' +
                    'color:#fff;font-size:0.7em;font-weight:700;padding:2px 6px;border-radius:4px;';
                badge.textContent = '✓ 선택';

                wrapper.appendChild(badge);
                wrapper.appendChild(canvas);
                wrapper.appendChild(lbl);
                wrapper.onclick = () => openMillsheetPreview(i);
                container.appendChild(wrapper);
            }
            updateMillsheetStatus();
        }

        async function openMillsheetPreview(pageNum) {
            millsheetPreviewCurrentPage = pageNum;
            const modal = document.getElementById('millsheetPreviewModal');
            modal.style.display = 'flex';
            await renderMillsheetPreviewPage(pageNum);
        }

        async function renderMillsheetPreviewPage(pageNum) {
            const numPages = millsheetPdfDoc.numPages;
            millsheetPreviewCurrentPage = pageNum;

            document.getElementById('millsheetPreviewTitle').textContent =
                `${millsheetFile.name}`;
            document.getElementById('millsheetPreviewPageInfo').textContent =
                `${pageNum} / ${numPages} 페이지`;

            const page = await millsheetPdfDoc.getPage(pageNum);
            // 모달 너비에 맞춰 scale 계산 (최대 800px 기준)
            const maxW = Math.min(window.innerWidth * 0.82, 860);
            const baseVp = page.getViewport({ scale: 1 });
            const scale = maxW / baseVp.width;
            const vp = page.getViewport({ scale });

            const canvas = document.getElementById('millsheetPreviewCanvas');
            canvas.width  = vp.width;
            canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

            updatePreviewSelectButton(pageNum);
        }

        function updatePreviewSelectButton(pageNum) {
            const btn = document.getElementById('millsheetPreviewSelectBtn');
            const isSelected = millsheetSelectedPages.includes(pageNum);
            if (isSelected) {
                btn.textContent = '✓ 선택 해제';
                btn.style.background = '#555';
                btn.style.color = '#fff';
            } else {
                btn.textContent = '✓ 이 페이지 저장에 포함';
                btn.style.background = '#1976D2';
                btn.style.color = '#fff';
            }
        }

        function toggleMillsheetPageFromModal() {
            const pageNum = millsheetPreviewCurrentPage;
            const idx = millsheetSelectedPages.indexOf(pageNum);
            const thumb = document.getElementById(`millsheetThumb_${pageNum}`);
            const badge = document.getElementById(`millsheetBadge_${pageNum}`);
            if (idx === -1) {
                millsheetSelectedPages.push(pageNum);
                if (thumb) { thumb.style.borderColor = '#1976D2'; thumb.style.background = 'rgba(25,118,210,0.15)'; }
                if (badge) badge.style.display = 'block';
            } else {
                millsheetSelectedPages.splice(idx, 1);
                if (thumb) { thumb.style.borderColor = '#444'; thumb.style.background = '#222'; }
                if (badge) badge.style.display = 'none';
            }
            updatePreviewSelectButton(pageNum);
            updateMillsheetStatus();
        }

        async function millsheetPreviewPrev() {
            if (millsheetPreviewCurrentPage > 1)
                await renderMillsheetPreviewPage(millsheetPreviewCurrentPage - 1);
        }

        async function millsheetPreviewNext() {
            if (millsheetPreviewCurrentPage < millsheetPdfDoc.numPages)
                await renderMillsheetPreviewPage(millsheetPreviewCurrentPage + 1);
        }

        function closeMillsheetPreview() {
            document.getElementById('millsheetPreviewModal').style.display = 'none';
        }

        // 모달 배경 클릭 시 닫기
        document.getElementById('millsheetPreviewModal')?.addEventListener('click', function(e) {
            if (e.target === this) closeMillsheetPreview();
        });

        function toggleMillsheetPage(wrapper, pageNum) {
            // 하위 호환용 (직접 호출되는 경우 없으나 유지)
            openMillsheetPreview(pageNum);
        }

        function updateMillsheetStatus() {
            const el = document.getElementById('millsheetUploadStatus');
            if (!el) return;
            if (millsheetSelectedPages.length === 0) {
                el.textContent = '선택된 페이지 없음';
                el.style.color = '#A0A0A0';
            } else {
                const sorted = [...millsheetSelectedPages].sort((a, b) => a - b);
                el.textContent = `선택된 페이지: ${sorted.join(', ')}페이지`;
                el.style.color = '#4FC3F7';
            }
        }

        function clearMillsheet() {
            millsheetFile = null;
            millsheetPdfDoc = null;
            millsheetSelectedPages = [];
            millsheetPreviewCurrentPage = 1;
            document.getElementById('millsheetFileInput').value = '';
            document.getElementById('millsheetFileName').textContent = '선택된 파일 없음';
            document.getElementById('millsheetClearBtn').style.display = 'none';
            document.getElementById('millsheetPageContainer').style.display = 'none';
            document.getElementById('millsheetThumbnails').innerHTML = '';
            document.getElementById('millsheetUploadStatus').textContent = '';
            document.getElementById('millsheetPreviewModal').style.display = 'none';
        }

        async function doMillsheetUpload(powderName, lotNumber, overwrite = false) {
            const formData = new FormData();
            formData.append('file', millsheetFile);
            formData.append('powder_name', powderName);
            formData.append('lot_number', lotNumber);
            formData.append('page_numbers', JSON.stringify(millsheetSelectedPages));
            formData.append('overwrite', overwrite ? 'true' : 'false');

            const resp = await fetch(`${API_BASE}/api/millsheet/upload`, {
                method: 'POST',
                body: formData
            });
            return await resp.json();
        }

        if (incomingFormElement) {
            // 검사일 기본값을 오늘 날짜로 설정
            const incomingDateInput = document.getElementById('incomingInspectionDate');
            if (incomingDateInput && !incomingDateInput.value) {
                const today = new Date().toISOString().split('T')[0];
                incomingDateInput.value = today;
            }

            incomingFormElement.addEventListener('submit', async (e) => {
                e.preventDefault();

                const powderName     = document.getElementById('incomingPowderName').value;
                const lotNumber      = document.getElementById('incomingLotNumber').value;
                const inspectionDate = document.getElementById('incomingInspectionDate').value;
                const inspectionType = document.getElementById('incomingInspectionType').value;
                const inspector      = document.getElementById('incomingInspector').value;
                const category       = 'incoming';

                // Millsheet 업로드 처리 (파일 선택 + 페이지 선택된 경우)
                if (millsheetFile) {
                    if (millsheetSelectedPages.length === 0) {
                        alert('저장할 Millsheet 페이지를 선택해주세요.');
                        return;
                    }
                    try {
                        let uploadResult = await doMillsheetUpload(powderName, lotNumber, false);
                        if (!uploadResult.success && uploadResult.exists) {
                            if (!confirm('기존 Millsheet 파일이 있습니다. 교체하시겠습니까?')) return;
                            uploadResult = await doMillsheetUpload(powderName, lotNumber, true);
                        }
                        if (!uploadResult.success) {
                            alert('Millsheet 업로드 실패: ' + uploadResult.message);
                            return;
                        }
                    } catch (err) {
                        alert('Millsheet 업로드 오류: ' + err.message);
                        return;
                    }
                }

                await startInspection(powderName, lotNumber, inspectionType, inspector, category, inspectionDate);
            });
        }

        // 배합검사 폼 처리
        const mixingFormElement = document.getElementById('mixingForm');

        if (mixingFormElement) {

            mixingFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();

            const powderName = document.getElementById('mixingPowderName').value;
            const lotNumber = document.getElementById('mixingLotNumber').value;
            const inspectionType = document.getElementById('mixingInspectionType').value;
            const inspector = document.getElementById('mixingInspector').value;
            const category = 'mixing';

            await startInspection(powderName, lotNumber, inspectionType, inspector, category);
        });
        }

        // 배합작업 조회에서 넘어온 경우 LOT 정보 자동 채우기
        function checkAndFillBlendingInspectionLot() {
            const batchLot = sessionStorage.getItem('blendingInspectionLot');
            const productName = sessionStorage.getItem('blendingInspectionProduct');

            if (batchLot && productName) {
                // LOT 정보 채우기 (배합 LOT는 제품명과 동일)
                setTimeout(() => {
                    const powderSelect = document.getElementById('mixingPowderName');
                    if (powderSelect) {
                        // 제품명을 분말명 선택에서 찾기
                        for (let option of powderSelect.options) {
                            if (option.value === productName) {
                                option.selected = true;
                                break;
                            }
                        }
                    }

                    const lotInput = document.getElementById('mixingLotNumber');
                    if (lotInput) {
                        lotInput.value = batchLot;
                    }

                    // sessionStorage 클리어
                    sessionStorage.removeItem('blendingInspectionLot');
                    sessionStorage.removeItem('blendingInspectionProduct');
                }, 300);  // 분말 목록 로딩 대기
            }
        }

        // 검사 시작 공통 함수
        async function startInspection(powderName, lotNumber, inspectionType, inspector, category, inspectionDate = null) {
            try {
                const response = await fetch(`${API_BASE}/api/start-inspection`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ powderName, lotNumber, inspectionType, inspector, category, inspectionDate })
                });

                const data = await response.json();

                if (data.success) {
                    if (data.isAutoApproved) {
                        alert(`${data.data.powderName} (LOT: ${data.data.lotNumber})\n일상검사 항목이 없어 자동 합격 처리되었습니다.`);
                        loadIncomingIncompleteInspections();
                        clearMillsheet();
                        return;
                    }

                    if (data.isExisting && data.data.isCompleted) {
                        alert('이미 완료된 검사입니다.');
                        return;
                    }

                    currentInspection = data.data;
                    currentItems = data.items;
                    currentSavedValues = {};
                    pendingResults = {};

                    showInspectionPage();
                } else {
                    if (data.needMillsheet) {
                        alert(data.message);
                        document.getElementById('millsheetFileInput').click();
                        return;
                    }
                    alert('검사 시작 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // ============================================
        // 검사 진행 페이지
        // ============================================
        async function continueInspection(powderName, lotNumber, category) {
            // Fetch existing inspection data
            try {
                const response = await fetch(`${API_BASE}/api/start-inspection`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ powderName, lotNumber, inspectionType: '', inspector: '', category })
                });

                const data = await response.json();

                if (data.success) {
                    currentInspection = data.data;
                    currentItems = data.items;
                    currentSavedValues = data.savedValues || {}; // 저장된 측정값
                    showInspectionPage();
                } else {
                    alert('검사 로딩 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function showInspectionPage() {
            document.getElementById('infoPowderName').textContent = currentInspection.powderName;
            document.getElementById('infoLotNumber').textContent = currentInspection.lotNumber;
            document.getElementById('infoInspectionDate').textContent = currentInspection.inspectionDate || '-';

            // 검사자 표시 영역 설정 (category에 따라 다르게)
            const inspectorDisplay = document.getElementById('inspectorDisplay');
            const category = currentInspection.category || 'incoming';

            if (category === 'incoming') {
                // 수입검사: 검사자를 표시만 (수정 불가)
                const inspectorName = currentInspection.inspector || '미지정';
                inspectorDisplay.innerHTML = `<p style="font-size: 1.1em; font-weight: 600; color: white;">${inspectorName}</p>`;
            } else if (category === 'mixing') {
                // 배합검사: 검사자를 선택할 수 있음
                // 먼저 select 요소 생성
                inspectorDisplay.innerHTML = `
                    <select id="infoInspector" onchange="updateInspector()" style="font-size: 1.1em; font-weight: 600; padding: 8px; border: 2px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.9); color: #E8E8E8; border-radius: 6px; cursor: pointer; width: 100%;">
                        <option value="">선택하세요</option>
                    </select>
                `;

                // select가 생성된 후 검사자 목록 로드
                await loadInspectorListForInspection();
                const inspectorSelect = document.getElementById('infoInspector');
                if (inspectorSelect && currentInspection.inspector) {
                    inspectorSelect.value = currentInspection.inspector;
                }
            }

            const completed = currentInspection.completedItems || [];
            const total = currentInspection.totalItems || [];
            document.getElementById('infoProgress').textContent = `${completed.length}/${total.length}`;

            renderInspectionItems();
            showPage('inspection');
        }

        // 검사 진행 화면용 검사자 목록 로드
        async function loadInspectorListForInspection() {
            try {
                const response = await fetch(`${API_BASE}/api/inspector-list`);
                const result = await response.json();

                const select = document.getElementById('infoInspector');
                if (!select) return;

                // 기존 옵션 유지하고 검사자 목록 추가
                select.innerHTML = '<option value="">선택하세요</option>';

                if (result.success && result.data) {
                    result.data.forEach(inspectorName => {
                        const option = document.createElement('option');
                        option.value = inspectorName;
                        option.textContent = inspectorName;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                console.error('검사자 목록 로딩 실패:', error);
            }
        }

        // 검사자 변경
        async function updateInspector() {
            const newInspector = document.getElementById('infoInspector').value;

            if (!newInspector) {
                alert('검사자를 선택하세요.');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/api/update-inspector`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        powderName: currentInspection.powderName,
                        lotNumber: currentInspection.lotNumber,
                        inspector: newInspector,
                        category: currentInspection.category || 'incoming'
                    })
                });

                const data = await response.json();

                if (data.success) {
                    currentInspection.inspector = newInspector;
                    alert('검사자가 변경되었습니다.');
                } else {
                    alert('검사자 변경 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        function renderInspectionItems() {
            const container = document.getElementById('inspectionItems');
            container.innerHTML = '';

            const completed = currentInspection.completedItems || [];

            currentItems.forEach(item => {
                const isCompleted = completed.includes(item.name);

                const itemDiv = document.createElement('div');
                itemDiv.className = 'card';
                itemDiv.style.borderLeft = isCompleted ? '5px solid #4CAF50' : '5px solid #F07D00';
                itemDiv.style.boxShadow = isCompleted ? '0 2px 8px rgba(76, 175, 80, 0.2)' : '0 2px 8px rgba(240, 125, 0, 0.2)';

                let html = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h3 style="margin: 0; color: #2c3e50; font-size: 1.3em;">${item.displayName}</h3>
                        ${isCompleted ? '<span class="badge pass" style="font-size: 1em; padding: 6px 12px;">✓ 완료</span>' : '<span class="badge progress" style="font-size: 1em; padding: 6px 12px;">진행중</span>'}
                    </div>
                    <div style="padding: 10px; background: #2C2C2C; border-radius: 5px; margin-bottom: 15px;">
                        <strong style="color: #F07D00;">측정 단위:</strong> ${item.unit} |
                        <strong style="color: #F07D00;">규격:</strong> ${item.min || '-'} ~ ${item.max || '-'} ${item.unit}
                    </div>
                `;

                if (!isCompleted) {
                    html += `<div id="item-${item.name}"></div>`;
                }

                itemDiv.innerHTML = html;
                container.appendChild(itemDiv);

                if (!isCompleted) {
                    renderItemInputs(item);
                }
            });
        }

        function renderItemInputs(item) {
            const container = document.getElementById(`item-${item.name}`);
            const savedValue = currentSavedValues[item.name] || {}; // 저장된 값 가져오기

            if (item.isParticleSize) {
                // 입도분석
                let html = '<h4 style="margin-bottom: 15px; color: #F07D00;">📊 입도분석 측정</h4>';
                html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px;">';
                item.particleSpecs.forEach((spec, index) => {
                    // 저장된 값이 있으면 파싱 (JSON 형식으로 저장되어 있을 수 있음)
                    let val1 = '', val2 = '';
                    if (savedValue.value1) {
                        try {
                            const parsed = JSON.parse(savedValue.value1);
                            if (parsed[index]) {
                                val1 = parsed[index][0] || '';
                                val2 = parsed[index][1] || '';
                            }
                        } catch (e) {
                            // 파싱 실패시 무시
                        }
                    }
                    html += `
                        <div style="padding: 15px; background: linear-gradient(135deg, #1E1E1E 0%, #2C2C2C 100%); border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <div style="font-weight: 600; margin-bottom: 8px; color: #2c3e50;">${spec.mesh_size}</div>
                            <div style="font-size: 0.9em; color: #A0A0A0; margin-bottom: 10px;">규격: ${spec.min_value}~${spec.max_value}%</div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <input type="number" step="0.1" placeholder="1차" id="${item.name}_${index}_1" value="${val1}" style="padding: 8px; border: 1px solid #444; border-radius: 5px;">
                                <input type="number" step="0.1" placeholder="2차" id="${item.name}_${index}_2" value="${val2}" style="padding: 8px; border: 1px solid #444; border-radius: 5px;">
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                html += `<div style="display: flex; gap:8px; margin-top: 20px;\"><button class="btn" onclick="judgeParticleSize('${item.name}')" style="flex:1; background:#F07D00;">🔎 판정</button><button class="btn" id="final-save-${item.name}" onclick="finalSaveParticleSize('${item.name}')" style="flex:1; background:#F07D00;" disabled>💾 최종저장</button></div>`;
                html += '<div class="result-display" id="result-' + item.name + '" style="display:none; margin-top: 15px;"></div>';
                container.innerHTML = html;

            } else if (item.isWeightBased) {
                // 중량 기반 항목 (겉보기밀도, 수분도, 회분도)
                let label1 = '', label2 = '';
                if (item.name === 'ApparentDensity') {
                    label1 = '빈컵중량';
                    label2 = '분말중량';
                } else if (item.name === 'Moisture') {
                    label1 = '초기중량';
                    label2 = '건조후중량';
                } else if (item.name === 'Ash') {
                    label1 = '초기중량';
                    label2 = '회분중량';
                }

                let html = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 15px 0;">';
                for (let i = 1; i <= 3; i++) {
                    // 저장된 값 가져오기
                    let val1 = '', val2 = '';
                    if (savedValue[`value${i}`]) {
                        try {
                            const parsed = JSON.parse(savedValue[`value${i}`]);
                            val1 = parsed[0] || '';
                            val2 = parsed[1] || '';
                        } catch (e) {
                            // 파싱 실패시 무시
                        }
                    }
                    html += `
                        <div style="padding: 15px; background: #2C2C2C; border-radius: 8px; border: 2px solid #333;">
                            <div style="font-weight: 600; margin-bottom: 10px; text-align: center; color: #F07D00;">${i}차 측정</div>
                            <div style="margin-bottom: 8px;">
                                <label style="font-size: 0.85em; color: #A0A0A0;">${label1} (g)</label>
                                <input type="number" step="0.01" placeholder="${label1}" id="${item.name}_${label1}_${i}" value="${val1}" style="width: 100%; padding: 8px; border: 1px solid #444; border-radius: 5px; margin-top: 4px;">
                            </div>
                            <div>
                                <label style="font-size: 0.85em; color: #A0A0A0;">${label2} (g)</label>
                                <input type="number" step="0.01" placeholder="${label2}" id="${item.name}_${label2}_${i}" value="${val2}" style="width: 100%; padding: 8px; border: 1px solid #444; border-radius: 5px; margin-top: 4px;">
                            </div>
                        </div>
                    `;
                }
                html += '</div>';
                html += `<div style="display: flex; gap:8px; margin-top: 10px;\"><button class="btn" onclick="judgeItem('${item.name}', true)" style="flex:1; background:#F07D00;">🔎 판정</button><button class="btn" id="final-save-${item.name}" onclick="finalSaveItem('${item.name}', true)" style="flex:1; background:#F07D00;" disabled>💾 최종저장</button></div>`;
                html += '<div class="result-display" id="result-' + item.name + '" style="display:none; margin-top: 15px;"></div>';
                container.innerHTML = html;

            } else {
                // 일반 항목
                let html = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 15px 0;">';
                for (let i = 1; i <= 3; i++) {
                    // 저장된 값 가져오기
                    const val = savedValue[`value${i}`] || '';
                    html += `
                        <div style="text-align: center;">
                            <label style="display: block; font-weight: 600; margin-bottom: 8px; color: #F07D00;">${i}차 측정</label>
                            <input type="number" step="0.01" placeholder="값 입력" id="${item.name}_${i}" value="${val}" style="width: 100%; padding: 12px; border: 2px solid #333; border-radius: 8px; font-size: 1.1em; text-align: center;">
                        </div>
                    `;
                }
                html += '</div>';
                html += `<div style="display: flex; gap:8px; margin-top: 10px;\"><button class="btn" onclick="judgeItem('${item.name}', false)" style="flex:1; background:#F07D00;">🔎 판정</button><button class="btn" id="final-save-${item.name}" onclick="finalSaveItem('${item.name}', false)" style="flex:1; background:#F07D00;" disabled>💾 최종저장</button></div>`;
                html += '<div class="result-display" id="result-' + item.name + '" style="display:none; margin-top: 15px;"></div>';
                container.innerHTML = html;
            }
        }

        // 로컬 판정: 입력값으로 평균/판정 계산 후 화면에 표시만 하고, 최종 저장 버튼을 활성화
        function judgeItem(itemName, isWeightBased) {
            const item = currentItems.find(i => i.name === itemName);
            if (!item) return alert('항목 정보를 찾을 수 없습니다.');

            let values = [];
            let average = null;
            let result = 'PASS';

            if (isWeightBased) {
                let label1 = '', label2 = '';
                if (itemName === 'ApparentDensity') {
                    label1 = '빈컵중량';
                    label2 = '분말중량';
                } else if (itemName === 'Moisture') {
                    label1 = '초기중량';
                    label2 = '건조후중량';
                } else if (itemName === 'Ash') {
                    label1 = '초기중량';
                    label2 = '회분중량';
                }

                const calcVals = [];
                for (let i = 1; i <= 3; i++) {
                    const val1 = document.getElementById(`${itemName}_${label1}_${i}`).value;
                    const val2 = document.getElementById(`${itemName}_${label2}_${i}`).value;
                    values.push(val1 || '', val2 || '');

                    if (itemName === 'ApparentDensity') {
                        if (val1 && val2) {
                            const density = (parseFloat(val2) - parseFloat(val1)) / 25;
                            calcVals.push(density);
                        }
                    } else if (itemName === 'Moisture') {
                        if (val1 && val2) {
                            const m = ((parseFloat(val1) - parseFloat(val2)) / parseFloat(val1)) * 100;
                            calcVals.push(m);
                        }
                    } else if (itemName === 'Ash') {
                        if (val1 && val2) {
                            // Ash: use decrease rate like Moisture ((initial - ash)/initial)*100
                            const a = ((parseFloat(val1) - parseFloat(val2)) / parseFloat(val1)) * 100;
                            calcVals.push(a);
                        }
                    }
                }

                if (calcVals.length > 0) {
                    average = Math.round((calcVals.reduce((s, v) => s + v, 0) / calcVals.length) * 100) / 100;
                }

            } else {
                const vals = [];
                for (let i = 1; i <= 3; i++) {
                    const val = document.getElementById(`${itemName}_${i}`).value;
                    values.push(val || '');
                    if (val !== '') vals.push(parseFloat(val));
                }
                if (vals.length > 0) {
                    average = Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100;
                }
            }

            // 규격 판정 (로컬)
            if (average !== null) {
                const min = item.min;
                const max = item.max;
                if ((min !== null && min !== undefined && average < min) || (max !== null && max !== undefined && average > max)) {
                    result = 'FAIL';
                } else {
                    result = 'PASS';
                }
            } else {
                return alert('유효한 측정값이 없습니다.');
            }

            // 결과 표시 및 임시저장
            const resultDiv = document.getElementById('result-' + itemName);
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `평균: ${average} | 결과: <span class="badge ${result === 'PASS' ? 'pass' : 'fail'}">${result}</span>`;

            pendingResults[itemName] = { values: values, average: average, result: result };

            // 최종 저장 버튼 활성화
            const finalBtn = document.getElementById(`final-save-${itemName}`);
            if (finalBtn) finalBtn.disabled = false;
        }

        // 서버에 실제 저장 (최종 저장)
        async function finalSaveItem(itemName, isWeightBased) {
            const pending = pendingResults[itemName];
            if (!pending) return alert('먼저 판정(검증)을 수행하세요.');

            // 배합검사의 경우 검사자 선택 필수
            if (currentInspection.category === 'mixing') {
                const inspectorSelect = document.getElementById('infoInspector');
                if (!inspectorSelect || !inspectorSelect.value) {
                    alert('검사자를 선택해주세요.');
                    return;
                }
            }

            try {
                const response = await fetch(`${API_BASE}/api/save-item`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        powderName: currentInspection.powderName,
                        lotNumber: currentInspection.lotNumber,
                        itemName: itemName,
                        values: pending.values
                    })
                });

                const data = await response.json();

                if (data.success) {
                    const resultDiv = document.getElementById('result-' + itemName);
                    resultDiv.style.display = 'block';
                    resultDiv.innerHTML = `평균: ${data.average} | 결과: <span class="badge ${data.result === 'PASS' ? 'pass' : 'fail'}">${data.result}</span>`;

                    // 완료 항목에 추가
                    if (!currentInspection.completedItems.includes(itemName)) {
                        currentInspection.completedItems.push(itemName);
                    }

                    // pending 제거 및 버튼 비활성화
                    delete pendingResults[itemName];
                    const finalBtn = document.getElementById(`final-save-${itemName}`);
                    if (finalBtn) finalBtn.disabled = true;

                    // 검사 진행 상황 갱신
                    setTimeout(async () => {
                        await checkInspectionCompletion();
                        renderInspectionItems();
                    }, 500);
                } else {
                    alert('저장 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function checkInspectionCompletion() {
            // 모든 항목이 완료되었는지 확인
            const totalItems = currentInspection.totalItems || [];
            const completedItems = currentInspection.completedItems || [];

            if (completedItems.length === totalItems.length && totalItems.length > 0) {
                // 모든 검사항목 완료
                alert('모든 검사항목이 완료되었습니다!');
                // 검사 카테고리에 따라 적절한 페이지로 이동
                if (currentInspection.category === 'incoming') {
                    showPage('incoming');
                } else if (currentInspection.category === 'mixing') {
                    showPage('mixing');
                }
            }
        }

        async function saveParticleSize(itemName) {
            const item = currentItems.find(i => i.name === itemName);
            const particleData = {};

            // mesh_size 값을 프론트엔드 키로 변환하는 매핑
            const meshSizeToKey = {
                '+180 um': '180',
                '+150 um': '150',
                '+106 um': '106',
                '+75 um': '75',
                '+45 um': '45',
                '-45 um': '45M'
            };

            item.particleSpecs.forEach((spec, index) => {
                const key = meshSizeToKey[spec.mesh_size] || spec.mesh_size;
                const val1 = document.getElementById(`${itemName}_${index}_1`).value;
                const val2 = document.getElementById(`${itemName}_${index}_2`).value;

                // Accept single measurement as valid: use whichever value is provided
                if (val1 || val2) {
                    const num1 = val1 ? parseFloat(val1) : null;
                    const num2 = val2 ? parseFloat(val2) : null;
                    let avg;
                    if (num1 !== null && num2 !== null) {
                        avg = ((num1 + num2) / 2).toFixed(1);
                    } else {
                        avg = (num1 !== null ? num1 : num2).toFixed(1);
                    }

                    const avgVal = parseFloat(avg);
                    const minOk = (spec.min_value === null || spec.min_value === undefined) ? true : avgVal >= spec.min_value;
                    const maxOk = (spec.max_value === null || spec.max_value === undefined) ? true : avgVal <= spec.max_value;
                    const result = (minOk && maxOk) ? '합격' : '불합격';

                    particleData[key] = {
                        val1: val1 || null,
                        val2: val2 || null,
                        avg: avg,
                        result: result
                    };
                }
            });

            try {
                const response = await fetch(`${API_BASE}/api/save-particle-size`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        powderName: currentInspection.powderName,
                        lotNumber: currentInspection.lotNumber,
                        particleData: particleData
                    })
                });

                const data = await response.json();

                if (data.success) {
                    const resultDiv = document.getElementById('result-' + itemName);
                    resultDiv.style.display = 'block';
                    resultDiv.innerHTML = `결과: <span class="badge ${data.result === 'PASS' ? 'pass' : 'fail'}">${data.result}</span>`;

                    // 완료된 항목에 추가
                    if (!currentInspection.completedItems.includes(itemName)) {
                        currentInspection.completedItems.push(itemName);
                    }

                    // 저장 성공 후 검사 진행 상황 다시 로드
                    setTimeout(async () => {
                        await checkInspectionCompletion();
                        renderInspectionItems();
                    }, 1500);
                } else {
                    alert('저장 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // 입도분석 로컬 판정: 결과만 표시하고 최종저장 버튼 활성화
        function judgeParticleSize(itemName) {
            const item = currentItems.find(i => i.name === itemName);
            if (!item) return alert('항목 정보를 찾을 수 없습니다.');

            const particleData = {};
            // mesh_size 값을 프론트엔드 키로 변환하는 매핑
            const meshSizeToKey = {
                '+180 um': '180',
                '+150 um': '150',
                '+106 um': '106',
                '+75 um': '75',
                '+45 um': '45',
                '-45 um': '45M'
            };
            let overallResult = 'PASS';
            let anyMeasured = false;

            // Build detailed result HTML
            let detailHtml = '<div style="display:flex;flex-direction:column;gap:8px;">';

            item.particleSpecs.forEach((spec, index) => {
                const meshLabel = spec.mesh_size || (`mesh${index}`);
                const key = meshSizeToKey[spec.mesh_size] || spec.mesh_size;
                const val1El = document.getElementById(`${itemName}_${index}_1`);
                const val2El = document.getElementById(`${itemName}_${index}_2`);
                const val1 = val1El ? val1El.value : '';
                const val2 = val2El ? val2El.value : '';

                if (val1 || val2) {
                    anyMeasured = true;
                    const num1 = val1 ? parseFloat(val1) : null;
                    const num2 = val2 ? parseFloat(val2) : null;
                    let avg;
                    if (num1 !== null && num2 !== null) {
                        avg = ((num1 + num2) / 2).toFixed(1);
                    } else {
                        avg = (num1 !== null ? num1 : num2).toFixed(1);
                    }

                    const avgVal = parseFloat(avg);
                    const minOk = (spec.min_value === null || spec.min_value === undefined) ? true : avgVal >= spec.min_value;
                    const maxOk = (spec.max_value === null || spec.max_value === undefined) ? true : avgVal <= spec.max_value;
                    const meshResult = (minOk && maxOk) ? '합격' : '불합격';
                    if (meshResult === '불합격') overallResult = 'FAIL';

                    particleData[key] = { val1: val1 || null, val2: val2 || null, avg: avg, result: meshResult };

                    detailHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:#242424;border-radius:6px;border:1px solid #333;">\
                        <div style="font-weight:600">${meshLabel}</div>\
                        <div style="font-size:0.95em;color:#444">평균: ${avg}%</div>\
                        <div><span class="badge ${meshResult === '합격' ? 'pass' : 'fail'}">${meshResult}</span></div>\
                    </div>`;
                } else {
                    // not measured
                    particleData[key] = { val1: val1 || null, val2: val2 || null, avg: null, result: '미측정' };
                    detailHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:#242424;border-radius:6px;border:1px solid #333;">\
                        <div style="font-weight:600">${meshLabel}</div>\
                        <div style="font-size:0.95em;color:#666">평균: -</div>\
                        <div><span class="badge" style="background:#555;">미측정</span></div>\
                    </div>`;
                    overallResult = 'FAIL';
                }
            });

            detailHtml += '</div>';

            if (!anyMeasured) return alert('유효한 측정값이 없습니다.');

            const resultDiv = document.getElementById('result-' + itemName);
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `전체결과: <span class="badge ${overallResult === 'PASS' ? 'pass' : 'fail'}">${overallResult}</span><div style="margin-top:10px;">${detailHtml}</div>`;

            pendingResults[itemName] = { particleData: particleData, result: overallResult };
            const finalBtn = document.getElementById(`final-save-${itemName}`);
            if (finalBtn) finalBtn.disabled = (overallResult !== 'PASS');
        }

        // 입도분석 최종 저장
        async function finalSaveParticleSize(itemName) {
            const pending = pendingResults[itemName];
            if (!pending) return alert('먼저 판정(검증)을 수행하세요.');

            if (pending.result !== 'PASS') return alert('모든 항목이 합격일 때만 최종저장할 수 있습니다.');

            // 배합검사의 경우 검사자 선택 필수
            if (currentInspection.category === 'mixing') {
                const inspectorSelect = document.getElementById('infoInspector');
                if (!inspectorSelect || !inspectorSelect.value) {
                    alert('검사자를 선택해주세요.');
                    return;
                }
            }

            try {
                const response = await fetch(`${API_BASE}/api/save-particle-size`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        powderName: currentInspection.powderName,
                        lotNumber: currentInspection.lotNumber,
                        particleData: pending.particleData
                    })
                });

                const data = await response.json();

                if (data.success) {
                    const resultDiv = document.getElementById('result-' + itemName);
                    resultDiv.style.display = 'block';
                    resultDiv.innerHTML = `결과: <span class="badge ${data.result === 'PASS' ? 'pass' : 'fail'}">${data.result}</span>`;

                    if (!currentInspection.completedItems.includes(itemName)) {
                        currentInspection.completedItems.push(itemName);
                    }

                    delete pendingResults[itemName];
                    const finalBtn = document.getElementById(`final-save-${itemName}`);
                    if (finalBtn) finalBtn.disabled = true;

                    setTimeout(async () => {
                        await checkInspectionCompletion();
                        renderInspectionItems();
                    }, 500);
                } else {
                    alert('저장 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // ============================================
        // 검사 결과 조회
        // ============================================
        async function loadPowderListForSearch(category = '') {
            try {
                const select = document.getElementById('searchPowderName');
                select.innerHTML = '<option value="">전체</option>';

                // 검사구분에 따라 다른 API 호출
                if (category === 'incoming') {
                    // 수입검사 -> 수입분말만
                    const response = await fetch(`${API_BASE}/api/powders`);
                    const data = await response.json();

                    if (data.success && data.powders) {
                        data.powders.forEach(powder => {
                            const option = document.createElement('option');
                            option.value = powder.powder_name;
                            option.textContent = powder.powder_name;
                            select.appendChild(option);
                        });
                    }
                } else if (category === 'mixing') {
                    // 배합검사 -> 배합분말(제품)만
                    const response = await fetch(`${API_BASE}/api/blending/products`);
                    const data = await response.json();

                    if (data.success && data.data) {
                        data.data.forEach(product => {
                            const option = document.createElement('option');
                            option.value = product.product_name;
                            option.textContent = product.product_name;
                            select.appendChild(option);
                        });
                    }
                } else {
                    // 전체 -> 수입분말 + 배합분말 모두
                    // 1. 수입분말
                    const powderResponse = await fetch(`${API_BASE}/api/powders`);
                    const powderData = await powderResponse.json();

                    if (powderData.success && powderData.powders) {
                        const incomingGroup = document.createElement('optgroup');
                        incomingGroup.label = '수입검사분말';

                        powderData.powders.forEach(powder => {
                            const option = document.createElement('option');
                            option.value = powder.powder_name;
                            option.textContent = powder.powder_name;
                            incomingGroup.appendChild(option);
                        });

                        if (incomingGroup.children.length > 0) {
                            select.appendChild(incomingGroup);
                        }
                    }

                    // 2. 배합분말
                    const productResponse = await fetch(`${API_BASE}/api/blending/products`);
                    const productData = await productResponse.json();

                    if (productData.success && productData.data) {
                        const blendingGroup = document.createElement('optgroup');
                        blendingGroup.label = '배합분말';

                        productData.data.forEach(product => {
                            const option = document.createElement('option');
                            option.value = product.product_name;
                            option.textContent = product.product_name;
                            blendingGroup.appendChild(option);
                        });

                        if (blendingGroup.children.length > 0) {
                            select.appendChild(blendingGroup);
                        }
                    }
                }

                // 검색 날짜 기본값 설정 (오늘 날짜)
                const today = new Date().toISOString().split('T')[0];
                const searchDateFromInput = document.getElementById('searchDateFrom');
                const searchDateToInput = document.getElementById('searchDateTo');
                if (searchDateFromInput && !searchDateFromInput.value) {
                    searchDateFromInput.value = today;
                }
                if (searchDateToInput && !searchDateToInput.value) {
                    searchDateToInput.value = today;
                }
            } catch (error) {
                console.error('분말 목록 로딩 실패:', error);
            }
        }

        // 검사구분 변경 시 분말명 목록 필터링
        const searchCategoryElement = document.getElementById('searchCategory');
        if (searchCategoryElement) {
            searchCategoryElement.addEventListener('change', (e) => {
                const category = e.target.value;
                loadPowderListForSearch(category);
            });
        }

        const searchFormElement = document.getElementById('searchForm');

        if (searchFormElement) {
            searchFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();

            const category = document.getElementById('searchCategory').value;
            const powderName = document.getElementById('searchPowderName').value;
            const lotNumber = document.getElementById('searchLotNumber').value;
            const dateFrom = document.getElementById('searchDateFrom').value;
            const dateTo = document.getElementById('searchDateTo').value;

            try {
                const includeHiddenSearch = document.getElementById('showHiddenSearchResults')?.checked;
                const params = new URLSearchParams();
                if (category) params.append('category', category);
                if (powderName) params.append('powderName', powderName);
                if (lotNumber) params.append('lotNumber', lotNumber);
                if (dateFrom) params.append('dateFrom', dateFrom);
                if (dateTo) params.append('dateTo', dateTo);
                if (includeHiddenSearch) params.append('include_hidden', 'true');

                const response = await fetch(`${API_BASE}/api/search-results?${params}`);
                const data = await response.json();

                const resultsDiv = document.getElementById('searchResults');

                if (data.success && data.data.length > 0) {
                    let html = `<table><tr><th>${t('category')}</th><th>${t('powderName')}</th><th>${t('lotNumber')}</th><th>${t('inspector')}</th><th>${t('inspectionTime')}</th><th>${t('inspectionType')}</th><th>${t('finalResult')}</th><th>${t('detail')}</th><th>Millsheet</th></tr>`;

                    data.data.forEach(item => {
                        const isHidden = item.is_hidden == 1;
                        const badgeClass = item.final_result === 'PASS' ? 'pass' : 'fail';
                        const categoryBadge = item.category === 'incoming'
                            ? `<span class="badge" style="background: #F07D00;">${t('incoming')}</span>`
                            : `<span class="badge" style="background: #F07D00;">${t('mixing')}</span>`;
                        const hiddenBadge = isHidden ? ' <span style="background:#888;color:#fff;font-size:0.75em;padding:2px 6px;border-radius:4px;">숨김</span>' : '';
                        const pName = item.powder_name.replace(/'/g, "\\'");
                        const lNum = item.lot_number.replace(/'/g, "\\'");

                        const hasMillsheet = item.millsheet_path ? true : false;
                        html += `
                            <tr style="${isHidden ? 'opacity:0.6;' : ''}">
                                <td>${categoryBadge}</td>
                                <td>${item.powder_name}</td>
                                <td>${item.lot_number}${hiddenBadge}</td>
                                <td>${item.inspector}</td>
                                <td>${item.inspection_time}</td>
                                <td>${item.inspection_type}</td>
                                <td><span class="badge ${badgeClass}">${item.final_result}</span></td>
                                <td>
                                    <div style="display: flex; gap: 5px;">
                                        <button class="btn" onclick="viewDetail('${pName}', '${lNum}')" style="padding: 6px 12px; font-size: 0.9em;">${t('view')}</button>
                                        ${isHidden
                                            ? `<button class="btn secondary" onclick="restoreInspectionResult('${pName}', '${lNum}', '${item.category}')" style="padding: 6px 12px; font-size: 0.9em;">복원</button>`
                                            : `<button class="btn secondary" onclick="hideInspectionResult('${pName}', '${lNum}', '${item.category}')" style="padding: 6px 12px; font-size: 0.9em;">숨기기</button>`
                                        }
                                    </div>
                                </td>
                                <td>
                                    ${hasMillsheet
                                        ? `<button class="btn" onclick="viewMillsheet('${pName}', '${lNum}')"
                                               style="padding: 6px 12px; font-size: 0.9em; background:#1565C0;">
                                               📄 보기</button>`
                                        : `<span style="color:#555; font-size:0.85em;">-</span>`
                                    }
                                </td>
                            </tr>
                        `;
                    });

                    html += '</table>';
                    resultsDiv.innerHTML = html;
                } else {
                    resultsDiv.innerHTML = `<div class="empty-message">${t('noResults')}</div>`;
                }
            } catch (error) {
                document.getElementById('searchResults').innerHTML = `<div class="empty-message">오류: ${error.message}</div>`;
            }
        });
        }

        function viewMillsheet(powderName, lotNumber) {
            window.open(`${API_BASE}/api/millsheet/${encodeURIComponent(powderName)}/${encodeURIComponent(lotNumber)}`, '_blank');
        }

        async function viewDetail(powderName, lotNumber) {
            try {
                const response = await fetch(`${API_BASE}/api/inspection-detail/${powderName}/${lotNumber}`);
                const data = await response.json();

                if (data.success) {
                    renderDetailPage(data.data);
                    showPage('detail');
                } else {
                    alert('상세 정보 로딩 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function hideInspectionResult(powderName, lotNumber, category) {
            if (!confirm('해당 검사결과를 숨기시겠습니까?')) return;
            try {
                const resp = await fetch(`${API_BASE}/api/inspection-result/${encodeURIComponent(powderName)}/${encodeURIComponent(lotNumber)}/hide`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hide: true, hidden_by: currentUserId })
                });
                const data = await resp.json();
                if (!data.success) { alert('숨기기 실패: ' + (data.message || '')); return; }
                document.getElementById('searchForm').dispatchEvent(new Event('submit'));
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function restoreInspectionResult(powderName, lotNumber, category) {
            if (!confirm('해당 검사결과를 복원하시겠습니까?')) return;
            try {
                const resp = await fetch(`${API_BASE}/api/inspection-result/${encodeURIComponent(powderName)}/${encodeURIComponent(lotNumber)}/hide`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hide: false })
                });
                const data = await resp.json();
                if (!data.success) { alert('복원 실패: ' + (data.message || '')); return; }
                document.getElementById('searchForm').dispatchEvent(new Event('submit'));
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        function renderDetailPage(detail) {
            const container = document.getElementById('detailContent');

            let html = `
                <div class="card" style="background: linear-gradient(135deg, #D06E00 0%, #F07D00 100%); color: white; margin-bottom: 20px;">
                    <h2 style="margin-bottom: 15px;">${detail.powder_name} - LOT ${detail.lot_number}</h2>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                        <div>
                            <p style="opacity: 0.9;">${t('inspector')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${detail.inspector}</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9;">${t('inspectionTime')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${detail.inspection_time}</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9;">${t('inspectionType')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${detail.inspection_type}</p>
                        </div>
                    </div>
                    <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
                        <div>
                            <p style="font-size: 1.1em; opacity: 0.9;">${t('finalResult')}</p>
                            <p style="font-size: 1.5em; font-weight: 700; margin-top: 5px;">${detail.final_result || '-'}</p>
                            ${detail.current_round > 1 ? `<p style="font-size:0.85em; opacity:0.7; margin-top:4px;">${detail.current_round}차 검사</p>` : ''}
                        </div>
                        ${detail.final_result === 'FAIL' ? `
                        <button class="btn" onclick="openRetestModal('${detail.powder_name}','${detail.lot_number}')"
                            style="background:#F07D00; padding:10px 18px; font-size:0.9em;">
                            🔄 재검사 요청
                        </button>` : ''}
                    </div>
                </div>
                <div class="card">
                    <div class="card-title">${t('inspectionDetails')}</div>
                    <div class="detail-grid">
            `;

            // 각 검사 항목 표시
            const items = [
                { nameKey: 'flowRate', prefix: 'flow_rate', unit: 's/50g' },
                { nameKey: 'apparentDensity', prefix: 'apparent_density', unit: 'g/cm³' },
                { nameKey: 'cContent', prefix: 'c_content', unit: '%' },
                { nameKey: 'cuContent', prefix: 'cu_content', unit: '%' },
                { nameKey: 'moisture', prefix: 'moisture', unit: '%' },
                { nameKey: 'ash', prefix: 'ash', unit: '%' },
                { nameKey: 'sinterChangeRate', prefix: 'sinter_change_rate', unit: '%' },
                { nameKey: 'sinterStrength', prefix: 'sinter_strength', unit: 'MPa' },
                { nameKey: 'formingStrength', prefix: 'forming_strength', unit: 'N' },
                { nameKey: 'formingLoad', prefix: 'forming_load', unit: 'MPa' }
            ];

            items.forEach(item => {
                const avg = detail[`${item.prefix}_avg`];
                const result = detail[`${item.prefix}_result`];

                if (avg !== null && avg !== undefined && avg !== '') {
                    const badgeClass = result === 'PASS' ? 'pass' : 'fail';
                    const spec = detail.powderSpec || {};
                    const specMin = spec[`${item.prefix}_min`];
                    const specMax = spec[`${item.prefix}_max`];
                    let specText = null;
                    if (specMin != null && specMax != null) {
                        specText = `규격: ${specMin} ~ ${specMax} ${item.unit}`;
                    } else if (specMin != null) {
                        specText = `규격: ≥ ${specMin} ${item.unit}`;
                    } else if (specMax != null) {
                        specText = `규격: ≤ ${specMax} ${item.unit}`;
                    }
                    html += `
                        <div class="detail-item">
                            <h4>${t(item.nameKey)}</h4>
                            ${specText ? `<p style="color:#A0A0A0;font-size:0.85em;margin:2px 0 4px;">${specText}</p>` : ''}
                            <p>${t('average')}: <strong>${avg} ${item.unit}</strong></p>
                            <p>${t('result')}: <span class="badge ${badgeClass}">${result}</span></p>
                        </div>
                    `;
                }
            });
            // 입도분석 표시 (있으면)
            if (detail.particleSizeSpecs && detail.particleSizeSpecs.length > 0) {
                html += `</div></div><div class="card" style="margin-top:16px;"><div class="card-title">${t('particleSize')}</div>`;
                html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">';

                // helper: mesh label -> column suffix
                const meshKey = (mesh) => {
                    if (!mesh) return mesh;
                    const s = mesh.toString().trim();
                    if (s.startsWith('-')) return '45m';
                    // extract digits
                    const m = s.match(/(\d+)/);
                    if (!m) return s.replace(/[^a-zA-Z0-9]/g, '');
                    const num = m[1];
                    if (num === '45' && s.startsWith('-')) return '45m';
                    return num;
                };

                detail.particleSizeSpecs.forEach((spec) => {
                    const key = meshKey(spec.mesh_size);
                    const avgField = `particle_size_${key}_avg`;
                    const resField = `particle_size_${key}_result`;

                    const avg = detail[avgField];
                    const res = detail[resField];
                    const displayRes = res === 'PASS' ? '합격' : (res === 'FAIL' ? '불합격' : (res || '-'));

                    const psMin = spec.min_value;
                    const psMax = spec.max_value;
                    let psSpecText = null;
                    if (psMin != null && psMax != null) {
                        psSpecText = `규격: ${psMin} ~ ${psMax} %`;
                    } else if (psMin != null) {
                        psSpecText = `규격: ≥ ${psMin} %`;
                    } else if (psMax != null) {
                        psSpecText = `규격: ≤ ${psMax} %`;
                    }

                    html += `
                        <div style="padding:12px;border-radius:8px;background:#1E1E1E;border:1px solid #333;">
                            <div style="font-weight:700;margin-bottom:6px;">${spec.mesh_size}</div>
                            ${psSpecText ? `<div style="font-size:0.85em;color:#A0A0A0;margin:2px 0 4px;">${psSpecText}</div>` : ''}
                            <div style="margin-top:8px;">평균: <strong>${avg !== null && avg !== undefined ? avg : '-' }%</strong></div>
                            <div>판정: <span class="badge ${res === 'PASS' ? 'pass' : (res === 'FAIL' ? 'fail' : '')}">${displayRes}</span></div>
                        </div>
                    `;
                });

                html += '</div></div>';
            } else {
                html += '</div></div>';
            }
            container.innerHTML = html;
        }

        // ============================================
        // 관리자 페이지 함수들
        // ============================================

        // 관리자 페이지 로드
        async function loadAdminPage() {
            await loadPowderSpecs(powderSpecMode);
            if (document.getElementById('particlePowderSelect')) {
                await loadParticlePowderList();
            }
            await loadInspectors();
            await loadOperators();
            await loadProductRecipes();
            if (currentIsProgramAdmin) {
                await loadPermissionsGrid();
                await loadUserIdList();
            }
        }

        // ============================================
        // 접속권한 설정 (프로그램관리자 전용)
        // ============================================

        const MENU_LABELS = {
            'dashboard': '대시보드',
            'incoming': '수입분말검사',
            'blending-orders': '배합작업계획등록',
            'blending': '배합작업',
            'blending-log': '배합작업현황조회',
            'mixing': '배합분말검사',
            'search': '검사결과조회',
            'rework': 'REWORK',
            'traceability': '추적성조회',
            'admin': '관리자모드'
        };

        async function loadPermissionsGrid() {
            const container = document.getElementById('permissionsGrid');
            if (!container) return;
            try {
                const resp = await fetch(`${API_BASE}/api/users`);
                const data = await resp.json();
                if (!data.success) return;

                const menus = Object.keys(MENU_LABELS);
                let html = '<table style="border-collapse:collapse; width:100%; font-size:0.9em;">';
                html += '<thead><tr style="background:var(--bg-elevated);">';
                html += '<th style="padding:10px 14px; text-align:left; border-bottom:1px solid #444;">사용자</th>';
                menus.forEach(m => {
                    html += `<th style="padding:8px 6px; text-align:center; border-bottom:1px solid #444; white-space:nowrap;">${MENU_LABELS[m]}</th>`;
                });
                html += '</tr></thead><tbody>';

                data.users.forEach(user => {
                    const allowed = user.allowedMenus || [];
                    html += `<tr style="border-bottom:1px solid #333;">`;
                    html += `<td style="padding:10px 14px; font-weight:600;">${user.name}<br><span style="font-size:0.85em;color:var(--text-secondary);">${user.userId}</span></td>`;
                    menus.forEach(m => {
                        const checked = allowed.includes(m);
                        const bg = checked ? '#2a5a2a' : '#2a2a2a';
                        const txt = checked ? '✓' : '';
                        html += `<td style="text-align:center; padding:6px;">
                            <div onclick="togglePermission('${user.userId}','${m}',this)"
                                 data-checked="${checked}"
                                 style="width:32px;height:32px;margin:auto;border-radius:6px;background:${bg};border:1px solid #555;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.1em;color:#7fff7f;">
                                ${txt}
                            </div>
                        </td>`;
                    });
                    html += '</tr>';
                });

                html += '</tbody></table>';
                container.innerHTML = html;
            } catch (e) {
                container.innerHTML = '<div class="empty-message">권한 정보를 불러올 수 없습니다.</div>';
            }
        }

        async function togglePermission(userId, menu, el) {
            const checked = el.getAttribute('data-checked') === 'true';
            const newChecked = !checked;
            el.setAttribute('data-checked', newChecked);
            el.style.background = newChecked ? '#2a5a2a' : '#2a2a2a';
            el.innerHTML = newChecked ? '✓' : '';

            // 해당 사용자의 현재 전체 권한 수집
            const row = el.closest('tr');
            const cells = row.querySelectorAll('[data-checked]');
            const menus = Object.keys(MENU_LABELS);
            const allowedMenus = [];
            cells.forEach((cell, i) => {
                if (cell.getAttribute('data-checked') === 'true') allowedMenus.push(menus[i]);
            });

            try {
                await fetch(`${API_BASE}/api/permissions/${userId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ allowedMenus })
                });
            } catch (e) {
                console.error('권한 저장 실패:', e);
            }
        }

        // ============================================
        // 사용자 관리 (프로그램관리자 전용)
        // ============================================

        async function loadUserIdList() {
            const container = document.getElementById('userIdList');
            if (!container) return;
            try {
                const resp = await fetch(`${API_BASE}/api/users`);
                const data = await resp.json();
                if (!data.success) return;

                let html = '<table style="border-collapse:collapse; width:100%;">';
                html += '<thead><tr style="background:var(--bg-elevated);"><th style="padding:10px;text-align:left;">ID</th><th style="padding:10px;text-align:left;">이름</th><th style="padding:10px;text-align:center;">비밀번호 변경</th><th style="padding:10px;text-align:center;">삭제</th></tr></thead><tbody>';

                data.users.forEach(user => {
                    const isCashup = user.userId === 'cashup';
                    html += `<tr style="border-bottom:1px solid #333;">
                        <td style="padding:10px; font-weight:600;">${user.userId}</td>
                        <td style="padding:10px;">${user.name}</td>
                        <td style="padding:10px; text-align:center;">
                            <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
                                <input type="password" id="pw_${user.userId}" placeholder="새 비밀번호" style="padding:6px 8px; border:1px solid #555; border-radius:4px; background:#1a1a1a; color:#eee; width:140px;">
                                <button class="btn secondary" style="padding:6px 10px;" onclick="changeUserPassword('${user.userId}')">변경</button>
                            </div>
                        </td>
                        <td style="padding:10px; text-align:center;">
                            ${isCashup ? '<span style="color:#666;">삭제불가</span>' : `<button class="btn danger" style="padding:6px 10px;" onclick="deleteUser('${user.userId}')">삭제</button>`}
                        </td>
                    </tr>`;
                });

                html += '</tbody></table>';
                container.innerHTML = html;
            } catch (e) {
                container.innerHTML = '<div class="empty-message">사용자 목록을 불러올 수 없습니다.</div>';
            }
        }

        async function addUser() {
            const userId = (document.getElementById('newUserId')?.value || '').trim();
            const name = (document.getElementById('newUserName')?.value || '').trim();
            const password = document.getElementById('newUserPassword')?.value || '';
            if (!userId || !name || !password) { alert('ID, 이름, 비밀번호를 모두 입력하세요.'); return; }
            try {
                const resp = await fetch(`${API_BASE}/api/users`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, name, password })
                });
                const data = await resp.json();
                if (!data.success) { alert('추가 실패: ' + data.message); return; }
                alert(data.message);
                document.getElementById('newUserId').value = '';
                document.getElementById('newUserName').value = '';
                document.getElementById('newUserPassword').value = '';
                await loadUserIdList();
                await loadPermissionsGrid();
            } catch (e) { alert('오류: ' + e.message); }
        }

        async function changeUserPassword(userId) {
            const pw = document.getElementById(`pw_${userId}`)?.value || '';
            if (pw.length < 4) { alert('비밀번호는 최소 4자 이상이어야 합니다.'); return; }
            try {
                const resp = await fetch(`${API_BASE}/api/users/${userId}/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pw })
                });
                const data = await resp.json();
                if (!data.success) { alert('변경 실패: ' + data.message); return; }
                alert(data.message);
                document.getElementById(`pw_${userId}`).value = '';
            } catch (e) { alert('오류: ' + e.message); }
        }

        async function deleteUser(userId) {
            if (!confirm(`사용자 "${userId}"를 삭제하시겠습니까?`)) return;
            try {
                const resp = await fetch(`${API_BASE}/api/users/${userId}`, { method: 'DELETE' });
                const data = await resp.json();
                if (!data.success) { alert('삭제 실패: ' + data.message); return; }
                alert(data.message);
                await loadUserIdList();
                await loadPermissionsGrid();
            } catch (e) { alert('오류: ' + e.message); }
        }

        // ============================================
        // 분말 사양 관리
        // ============================================

        async function loadPowderSpecs(filterCategory = '') {
            try {
                const response = await fetch(`${API_BASE}/api/admin/powder-spec`);
                const data = await response.json();
                const namesDiv = document.getElementById('powderNamesList');
                if (data.success && data.data.length > 0) {
                    namesDiv.innerHTML = '';

                    let specs = data.data;

                    // 배합 분말 모드인 경우, 레시피에 등록된 제품명과 교차검증하여 표시
                    if (filterCategory === 'mixing') {
                        try {
                            const r = await fetch(`${API_BASE}/api/admin/recipes`);
                            const rdata = await r.json();
                            if (rdata.success && rdata.data.length > 0) {
                                const productNames = new Set(rdata.data.map(p => p.product_name));
                                specs = specs.filter(s => productNames.has(s.powder_name));
                            } else {
                                // 레시피가 없으면 빈 목록
                                specs = [];
                            }
                        } catch (err) {
                            console.error('레시피 로딩 실패:', err);
                            specs = [];
                        }
                    } else if (filterCategory) {
                        specs = specs.filter(s => s.category === filterCategory);
                    }

                    if (specs.length === 0) {
                        namesDiv.innerHTML = `<div class="empty-message">${t('noPowders')}</div>`;
                        const detailDiv = document.getElementById('powderSpecDetail');
                        if (detailDiv) detailDiv.innerHTML = `<div class="empty-message">${t('noPowders')}</div>`;
                        return;
                    }

                    specs.forEach(spec => {
                        const item = document.createElement('div');
                        item.className = 'powder-item';
                        item.dataset.specId = spec.id;
                        item.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">` +
                            `<div style="flex: 1;" class="powder-name-text"><strong>${spec.powder_name}</strong></div>` +
                            `<input type="checkbox" class="powder-checkbox" data-spec-id="${spec.id}" style="cursor: pointer; margin-left: 8px;">` +
                            `</div>`;

                        // 체크박스 클릭 시만 우측 화면 변경
                        const checkbox = item.querySelector('.powder-checkbox');
                        checkbox.addEventListener('change', (e) => {
                            // 다른 모든 체크박스 해제
                            document.querySelectorAll('.powder-checkbox').forEach(cb => {
                                if (cb !== checkbox) cb.checked = false;
                            });

                            // 체크된 경우에만 우측 화면 표시
                            if (checkbox.checked) {
                                showPowderSpecDetail(spec.id);
                            }
                        });

                        namesDiv.appendChild(item);
                    });

                    // 자동 선택: 첫 번째 체크박스 체크
                    const firstCheckbox = namesDiv.querySelector('.powder-checkbox');
                    if (firstCheckbox) {
                        firstCheckbox.checked = true;
                        const firstId = firstCheckbox.dataset.specId;
                        showPowderSpecDetail(parseInt(firstId));
                    }
                } else {
                    namesDiv.innerHTML = `<div class="empty-message">${t('noPowders')}</div>`;
                    const detailDiv = document.getElementById('powderSpecDetail');
                    if (detailDiv) detailDiv.innerHTML = `<div class="empty-message">${t('noPowders')}</div>`;
                }
            } catch (error) {
                console.error('분말 목록 로딩 실패:', error);
            }
        }

        let selectedPowderSpecId = null;

        async function showPowderSpecDetail(specId) {
            // 편집 모드 플래그 리셋 (상세 다시 로드 시 편집 상태 해제)
            isInlineEditMode = false;

            try {
                const response = await fetch(`${API_BASE}/api/admin/powder-spec`);
                const data = await response.json();
                if (!data.success) return;

                const spec = data.data.find(s => s.id === specId);
                if (!spec) return;

                selectedPowderSpecId = spec.id;

                const detailDiv = document.getElementById('powderSpecDetail');
                const headerDiv = document.getElementById('powderSpecHeader');

                // 헤더: 분말명(왼쪽) + 수정/삭제 버튼(오른쪽)
                headerDiv.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h3 style="margin: 0; color: #E8E8E8; font-size: 1.3em;">${spec.powder_name}</h3>
                        <div>
                            <button class="btn secondary" id="specEditBtn" style="margin-right:6px; padding:5px 12px; font-size:0.85em;">수정</button>
                            <button class="btn danger" id="specDeleteBtn" style="padding:5px 12px; font-size:0.85em;">삭제</button>
                        </div>
                    </div>
                `;

                let html = `<div style="overflow-x: auto;">`;
                html += `<table id="specTable" style="width: 100%; border-collapse: collapse; font-size: 1em; table-layout: fixed;" data-spec-id="${spec.id}" data-powder-name="${spec.powder_name}" data-category="${spec.category}">`;
                html += `<thead>`;
                html += `<tr style="background: #1E1E1E;">`;
                html += `<th style="width: 22%; padding: 12px 14px; text-align: left; border: 1px solid #333; font-weight: 600; font-size: 1em; color: #444; white-space: nowrap;">검사항목</th>`;
                html += `<th style="width: 15%; padding: 12px 14px; text-align: center; border: 1px solid #333; font-weight: 600; font-size: 1em; color: #444; white-space: nowrap;">단위</th>`;
                html += `<th style="width: 18%; padding: 12px 14px; text-align: center; border: 1px solid #333; font-weight: 600; font-size: 1em; color: #444; white-space: nowrap;">최소값</th>`;
                html += `<th style="width: 18%; padding: 12px 14px; text-align: center; border: 1px solid #333; font-weight: 600; font-size: 1em; color: #444; white-space: nowrap;">최대값</th>`;
                html += `<th style="width: 27%; padding: 12px 14px; text-align: center; border: 1px solid #333; font-weight: 600; font-size: 1em; color: #444; white-space: nowrap;">검사타입</th>`;
                html += `</tr>`;
                html += `</thead>`;
                html += `<tbody>`;

                // 각 검사항목을 행으로 추가
                const items = [
                    { name: '유동도', field: 'flow_rate', unit: 's/50g', min: spec.flow_rate_min, max: spec.flow_rate_max, type: spec.flow_rate_type },
                    { name: '겉보기밀도', field: 'apparent_density', unit: 'g/cm³', min: spec.apparent_density_min, max: spec.apparent_density_max, type: spec.apparent_density_type },
                    { name: 'C함량', field: 'c_content', unit: '%', min: spec.c_content_min, max: spec.c_content_max, type: spec.c_content_type },
                    { name: 'Cu함량', field: 'cu_content', unit: '%', min: spec.cu_content_min, max: spec.cu_content_max, type: spec.cu_content_type },
                    { name: '수분도', field: 'moisture', unit: '%', min: spec.moisture_min, max: spec.moisture_max, type: spec.moisture_type },
                    { name: '회분도', field: 'ash', unit: '%', min: spec.ash_min, max: spec.ash_max, type: spec.ash_type },
                    { name: '소결변화율', field: 'sinter_change_rate', unit: '%', min: spec.sinter_change_rate_min, max: spec.sinter_change_rate_max, type: spec.sinter_change_rate_type },
                    { name: '소결강도', field: 'sinter_strength', unit: 'MPa', min: spec.sinter_strength_min, max: spec.sinter_strength_max, type: spec.sinter_strength_type },
                    { name: '성형강도', field: 'forming_strength', unit: 'N', min: spec.forming_strength_min, max: spec.forming_strength_max, type: spec.forming_strength_type },
                    { name: '성형하중', field: 'forming_load', unit: 'MPa', min: spec.forming_load_min, max: spec.forming_load_max, type: spec.forming_load_type },
                    { name: '입도분석', field: 'particle_size', unit: '', min: '', max: '', type: spec.particle_size_type }
                ];

                items.forEach(item => {
                    const isInactive = item.type === '비활성' || !item.type;
                    const rowStyle = isInactive ? 'opacity: 0.45;' : '';
                    html += `<tr data-field="${item.field}" style="${rowStyle}">`;
                    html += `<td style="padding: 10px 14px; border: 1px solid #333; white-space: nowrap;"><strong style="font-weight: 600;">${item.name}</strong></td>`;
                    html += `<td style="padding: 10px 14px; border: 1px solid #333; text-align: center; white-space: nowrap;">${item.unit}</td>`;
                    html += `<td class="editable-min" style="padding: 10px 14px; border: 1px solid #333; text-align: center; white-space: nowrap;" data-value="${item.min || ''}">${item.min || '-'}</td>`;
                    html += `<td class="editable-max" style="padding: 10px 14px; border: 1px solid #333; text-align: center; white-space: nowrap;" data-value="${item.max || ''}">${item.max || '-'}</td>`;
                    html += `<td class="editable-type" style="padding: 10px 14px; border: 1px solid #333; text-align: center; white-space: nowrap;" data-value="${item.type || '비활성'}">${item.type || '비활성'}</td>`;
                    html += `</tr>`;
                });

                html += `</tbody>`;
                html += `</table>`;
                html += `</div>`;

                // 입도분석 상세 정보 (활성화된 경우)
                if (spec.particle_size_type && spec.particle_size_type !== '비활성') {
                    // particle_size 테이블에서 데이터 가져오기
                    try {
                        const particleResponse = await fetch(`${API_BASE}/api/particle-size-spec/${spec.powder_name}`);
                        const particleData = await particleResponse.json();

                        if (particleData.success && particleData.data.length > 0) {
                            html += `<div id="particleDetailSection" style="margin-top: 14px; padding: 12px; background: #1E1E1E; border-radius: 6px; border: 1px solid #333;">`;
                            html += `<h5 style="margin: 0 0 10px 0; color: #F07D00; font-size: 0.95em; font-weight: 600;">📊 입도분석 상세</h5>`;
                            html += `<div id="particleGrid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">`;

                            // particle_size 테이블 데이터를 순회하며 표시
                            particleData.data.forEach(p => {
                                html += `<div class="particle-item" data-mesh="${p.mesh_size}" data-min="${p.min_value || ''}" data-max="${p.max_value || ''}" style="padding: 7px 9px; background: white; border-radius: 4px; font-size: 0.88em; border: 1px solid #333; color: #000;">`;
                                html += `<strong style="font-weight: 600;">${p.mesh_size}</strong>: `;
                                html += `<span class="particle-min">${p.min_value || '-'}</span> ~ <span class="particle-max">${p.max_value || '-'}</span> %`;
                                html += `</div>`;
                            });

                            html += `</div>`;
                            html += `</div>`;
                        }
                    } catch (err) {
                        console.error('입도분석 데이터 로딩 실패:', err);
                    }
                }

                detailDiv.innerHTML = html;

                const editBtn = document.getElementById('specEditBtn');
                const delBtn = document.getElementById('specDeleteBtn');
                if (editBtn) editBtn.onclick = () => toggleInlineEdit();
                if (delBtn) delBtn.onclick = () => deletePowderSpec(spec.id, spec.powder_name);

            } catch (error) {
                console.error('사양 상세 로딩 실패:', error);
            }
        }

        // 인라인 편집 모드 전역 변수
        let isInlineEditMode = false;

        // 편집 모드 취소: 저장하지 않고 원래 상태로 복원
        function cancelInlineEdit() {
            if (!isInlineEditMode) return;
            isInlineEditMode = false;
            // 현재 선택된 사양을 다시 로드하여 편집 전 상태로 복원
            if (selectedPowderSpecId) {
                showPowderSpecDetail(selectedPowderSpecId);
            }
        }

        function toggleInlineEdit() {
            const editBtn = document.getElementById('specEditBtn');
            if (!isInlineEditMode) {
                enableInlineEdit();
                editBtn.textContent = '저장';
                editBtn.classList.remove('secondary');
                editBtn.classList.add('primary');
                isInlineEditMode = true;
            } else {
                saveInlineEdit();
            }
        }

        function enableInlineEdit() {
            const table = document.getElementById('specTable');
            if (!table) return;

            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const minCell = row.querySelector('.editable-min');
                const maxCell = row.querySelector('.editable-max');
                const typeCell = row.querySelector('.editable-type');

                if (minCell) {
                    const minValue = minCell.dataset.value;
                    minCell.innerHTML = `<input type="number" step="0.01" value="${minValue}" style="width:100%; padding:4px; border:1px solid #ddd; border-radius:3px; text-align:center;">`;
                }

                if (maxCell) {
                    const maxValue = maxCell.dataset.value;
                    maxCell.innerHTML = `<input type="number" step="0.01" value="${maxValue}" style="width:100%; padding:4px; border:1px solid #ddd; border-radius:3px; text-align:center;">`;
                }

                if (typeCell) {
                    const typeValue = typeCell.dataset.value;
                    typeCell.innerHTML = `
                        <select style="width:100%; padding:4px; border:1px solid #ddd; border-radius:3px;">
                            <option value="일상" ${typeValue === '일상' ? 'selected' : ''}>일상</option>
                            <option value="정기" ${typeValue === '정기' ? 'selected' : ''}>정기</option>
                            <option value="비활성" ${typeValue === '비활성' ? 'selected' : ''}>비활성</option>
                        </select>
                    `;
                }
            });

            // 입도분석 항목도 편집 가능하게 만들기
            const particleItems = document.querySelectorAll('.particle-item');
            particleItems.forEach(item => {
                const minValue = item.dataset.min || '';
                const maxValue = item.dataset.max || '';
                const meshSize = item.dataset.mesh;

                const minSpan = item.querySelector('.particle-min');
                const maxSpan = item.querySelector('.particle-max');

                if (minSpan) {
                    minSpan.innerHTML = `<input type="number" step="0.01" value="${minValue}" style="width:60px; padding:2px; border:1px solid #ddd; border-radius:3px; text-align:center;">`;
                }

                if (maxSpan) {
                    maxSpan.innerHTML = `<input type="number" step="0.01" value="${maxValue}" style="width:60px; padding:2px; border:1px solid #ddd; border-radius:3px; text-align:center;">`;
                }
            });
        }

        async function saveInlineEdit() {
            const table = document.getElementById('specTable');
            if (!table) return;

            const specId = table.dataset.specId;
            const powderName = table.dataset.powderName;
            const category = table.dataset.category;
            const rows = table.querySelectorAll('tbody tr');

            const data = {
                id: specId,
                powder_name: powderName,
                category: category
            };

            rows.forEach(row => {
                const field = row.dataset.field;
                const minCell = row.querySelector('.editable-min input');
                const maxCell = row.querySelector('.editable-max input');
                const typeCell = row.querySelector('.editable-type select');

                if (minCell) data[`${field}_min`] = minCell.value || null;
                if (maxCell) data[`${field}_max`] = maxCell.value || null;
                if (typeCell) data[`${field}_type`] = typeCell.value;
            });

            try {
                // 1. 분말 사양 저장
                const response = await fetch(`${API_BASE}/api/admin/powder-spec/${specId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                if (!result.success) {
                    alert('저장 실패: ' + (result.message || '알 수 없는 오류'));
                    return;
                }

                // 2. 입도분석 데이터 저장 (있는 경우)
                const particleItems = document.querySelectorAll('.particle-item');
                if (particleItems.length > 0) {
                    const particleSpecs = [];
                    particleItems.forEach(item => {
                        const meshSize = item.dataset.mesh;
                        const minInput = item.querySelector('.particle-min input');
                        const maxInput = item.querySelector('.particle-max input');

                        if (minInput && maxInput) {
                            particleSpecs.push({
                                powder_name: powderName,
                                mesh_size: meshSize,
                                min_value: parseFloat(minInput.value) || 0,
                                max_value: parseFloat(maxInput.value) || 0
                            });
                        }
                    });

                    if (particleSpecs.length > 0) {
                        const particleResponse = await fetch(`${API_BASE}/api/admin/particle-size/bulk`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                powder_name: powderName,
                                specs: particleSpecs
                            })
                        });

                        const particleResult = await particleResponse.json();
                        if (!particleResult.success) {
                            alert('입도분석 저장 실패: ' + (particleResult.message || '알 수 없는 오류'));
                            return;
                        }
                    }
                }

                alert('저장되었습니다.');
                isInlineEditMode = false;
                // 다시 로드
                showPowderSpecDetail(parseInt(specId));

            } catch (error) {
                console.error('저장 실패:', error);
                alert('저장 중 오류가 발생했습니다.');
            }
        }

        function showAddPowderForm() {
            document.getElementById('powderFormTitle').textContent = t('addPowder');
            document.getElementById('powderSpecId').value = '';
            document.getElementById('powderForm').reset();
            document.getElementById('adminPowderCategory').value = '';  // 선택하게 함
            document.getElementById('adminPowderNameInput').style.display = 'none';
            document.getElementById('adminPowderNameSelect').style.display = 'none';
            document.getElementById('adminPowderNameInput').removeAttribute('required');
            document.getElementById('adminPowderNameSelect').removeAttribute('required');

            // 폼 리셋 후 모든 검사 항목을 '비활성'으로 초기화하고 입도필드 표시여부 결정
            setTimeout(() => {
                // 타입을 모두 비활성으로 설정
                const typeIds = ['flowRateType','apparentDensityType','cContentType','cuContentType','moistureType','ashType','sinterChangeRateType','sinterStrengthType','formingStrengthType','formingLoadType','particleSizeType'];
                typeIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '비활성';
                });

                // 모든 min/max 입력 필드 초기화
                const fieldIds = ['flowRateMin','flowRateMax','apparentDensityMin','apparentDensityMax','cContentMin','cContentMax','cuContentMin','cuContentMax','moistureMin','moistureMax','ashMin','ashMax','sinterChangeRateMin','sinterChangeRateMax','sinterStrengthMin','sinterStrengthMax','formingStrengthMin','formingStrengthMax','formingLoadMin','formingLoadMax','particle_180_min','particle_180_max','particle_150_min','particle_150_max','particle_106_min','particle_106_max','particle_75_min','particle_75_max','particle_45_min','particle_45_max','particle_45m_min','particle_45m_max'];
                fieldIds.forEach(id => {
                    const f = document.getElementById(id);
                    if (f) f.value = '';
                });

                toggleParticleInputs();
            }, 0);

            document.getElementById('powderFormContainer').style.display = 'block';
            // 리스트 화면 숨기기
            const layoutDiv = document.querySelector('.admin-powder-layout');
            if (layoutDiv) layoutDiv.style.display = 'none';
        }

        function toggleParticleInputs() {
            const particleType = document.getElementById('particleSizeType').value;
            const particleInputs = document.getElementById('particleSizeInputs');

            if (particleType === '비활성') {
                particleInputs.style.display = 'none';
            } else {
                particleInputs.style.display = 'block';
            }
        }

        async function handlePowderCategoryChange() {
            const category = document.getElementById('adminPowderCategory').value;
            const inputField = document.getElementById('adminPowderNameInput');
            const selectField = document.getElementById('adminPowderNameSelect');

            if (category === 'incoming') {
                // 수입검사: 직접 입력
                inputField.style.display = 'block';
                selectField.style.display = 'none';
                inputField.setAttribute('required', 'required');
                selectField.removeAttribute('required');
                inputField.value = '';
            } else if (category === 'mixing') {
                // 배합검사: 배합규격서의 제품명에서 선택
                selectField.style.display = 'block';
                inputField.style.display = 'none';
                selectField.setAttribute('required', 'required');
                inputField.removeAttribute('required');

                // 배합규격서 제품명 목록 로드
                try {
                    const response = await fetch(`${API_BASE}/api/admin/recipes`);
                    const data = await response.json();

                    let options = '<option value="">' + t('selectPlaceholder') + '</option>';
                    if (data.success && data.data.length > 0) {
                        // 중복 제거를 위해 Set 사용
                        const productNames = [...new Set(data.data.map(p => p.product_name))];
                        productNames.forEach(name => {
                            options += `<option value="${name}">${name}</option>`;
                        });
                    }
                    selectField.innerHTML = options;
                } catch (error) {
                    console.error('Failed to load product names:', error);
                }
            } else {
                // 미선택 상태
                inputField.style.display = 'none';
                selectField.style.display = 'none';
                inputField.removeAttribute('required');
                selectField.removeAttribute('required');
            }
        }

        function hidePowderForm() {
            document.getElementById('powderFormContainer').style.display = 'none';
            document.getElementById('powderForm').reset();
            // 리스트 화면 다시 보이기
            const layoutDiv = document.querySelector('.admin-powder-layout');
            if (layoutDiv) layoutDiv.style.display = 'flex';
        }

        async function editPowderSpec(specId) {
            try {
                const response = await fetch(`${API_BASE}/api/admin/powder-spec`);
                const data = await response.json();

                if (data.success) {
                    const spec = data.data.find(s => s.id === specId);
                    if (spec) {
                        document.getElementById('powderFormTitle').textContent = t('editPowder');
                        document.getElementById('powderSpecId').value = spec.id;

                        // 검사구분 먼저 설정
                        document.getElementById('adminPowderCategory').value = spec.category || 'incoming';

                        // 검사구분에 따라 필드 변경
                        await handlePowderCategoryChange();

                        // 분말명 설정
                        if (spec.category === 'incoming') {
                            document.getElementById('adminPowderNameInput').value = spec.powder_name;
                        } else if (spec.category === 'mixing') {
                            document.getElementById('adminPowderNameSelect').value = spec.powder_name;
                        }

                        // 각 항목 값 채우기
                        document.getElementById('flowRateMin').value = spec.flow_rate_min || '';
                        document.getElementById('flowRateMax').value = spec.flow_rate_max || '';
                        document.getElementById('flowRateType').value = spec.flow_rate_type || '일상';

                        document.getElementById('apparentDensityMin').value = spec.apparent_density_min || '';
                        document.getElementById('apparentDensityMax').value = spec.apparent_density_max || '';
                        document.getElementById('apparentDensityType').value = spec.apparent_density_type || '일상';

                        document.getElementById('cContentMin').value = spec.c_content_min || '';
                        document.getElementById('cContentMax').value = spec.c_content_max || '';
                        document.getElementById('cContentType').value = spec.c_content_type || '일상';

                        document.getElementById('cuContentMin').value = spec.cu_content_min || '';
                        document.getElementById('cuContentMax').value = spec.cu_content_max || '';
                        document.getElementById('cuContentType').value = spec.cu_content_type || '일상';

                        document.getElementById('moistureMin').value = spec.moisture_min || '';
                        document.getElementById('moistureMax').value = spec.moisture_max || '';
                        document.getElementById('moistureType').value = spec.moisture_type || '일상';

                        document.getElementById('ashMin').value = spec.ash_min || '';
                        document.getElementById('ashMax').value = spec.ash_max || '';
                        document.getElementById('ashType').value = spec.ash_type || '일상';

                        document.getElementById('sinterChangeRateMin').value = spec.sinter_change_rate_min || '';
                        document.getElementById('sinterChangeRateMax').value = spec.sinter_change_rate_max || '';
                        document.getElementById('sinterChangeRateType').value = spec.sinter_change_rate_type || '일상';

                        document.getElementById('sinterStrengthMin').value = spec.sinter_strength_min || '';
                        document.getElementById('sinterStrengthMax').value = spec.sinter_strength_max || '';
                        document.getElementById('sinterStrengthType').value = spec.sinter_strength_type || '일상';

                        document.getElementById('formingStrengthMin').value = spec.forming_strength_min || '';
                        document.getElementById('formingStrengthMax').value = spec.forming_strength_max || '';
                        document.getElementById('formingStrengthType').value = spec.forming_strength_type || '일상';

                        document.getElementById('formingLoadMin').value = spec.forming_load_min || '';
                        document.getElementById('formingLoadMax').value = spec.forming_load_max || '';
                        document.getElementById('formingLoadType').value = spec.forming_load_type || '일상';

                        document.getElementById('particleSizeType').value = spec.particle_size_type || '일상';
                        toggleParticleInputs();

                        // 입도분석 규격 로드
                        if (spec.particle_size_type !== '비활성') {
                            const particleResponse = await fetch(`${API_BASE}/api/admin/particle-size?powder_name=${encodeURIComponent(spec.powder_name)}`);
                            const particleData = await particleResponse.json();

                            if (particleData.success && particleData.data.length > 0) {
                                particleData.data.forEach(ps => {
                                    let meshId = '';
                                    if (ps.mesh_size === '+180 um') meshId = '180';
                                    else if (ps.mesh_size === '+150 um') meshId = '150';
                                    else if (ps.mesh_size === '+106 um') meshId = '106';
                                    else if (ps.mesh_size === '+75 um') meshId = '75';
                                    else if (ps.mesh_size === '+45 um') meshId = '45';
                                    else if (ps.mesh_size === '-45 um') meshId = '45m';

                                    if (meshId) {
                                        document.getElementById(`particle_${meshId}_min`).value = ps.min_value || '';
                                        document.getElementById(`particle_${meshId}_max`).value = ps.max_value || '';
                                    }
                                });
                            }
                        }

                        document.getElementById('powderFormContainer').style.display = 'block';
                        // 리스트 화면 숨기기
                        const layoutDiv = document.querySelector('.admin-powder-layout');
                        if (layoutDiv) layoutDiv.style.display = 'none';
                    }
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        const powderFormElement = document.getElementById('powderForm');


        if (powderFormElement) {


            powderFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();

            const specId = document.getElementById('powderSpecId').value;
            const category = document.getElementById('adminPowderCategory').value;

            // 검사구분에 따라 분말명 가져오기
            let powderName;
            if (category === 'incoming') {
                powderName = document.getElementById('adminPowderNameInput').value;
            } else if (category === 'mixing') {
                powderName = document.getElementById('adminPowderNameSelect').value;
            }

            const powderData = {
                powder_name: powderName,
                category: category,
                flow_rate_min: document.getElementById('flowRateMin').value || null,
                flow_rate_max: document.getElementById('flowRateMax').value || null,
                flow_rate_type: document.getElementById('flowRateType').value,
                apparent_density_min: document.getElementById('apparentDensityMin').value || null,
                apparent_density_max: document.getElementById('apparentDensityMax').value || null,
                apparent_density_type: document.getElementById('apparentDensityType').value,
                c_content_min: document.getElementById('cContentMin').value || null,
                c_content_max: document.getElementById('cContentMax').value || null,
                c_content_type: document.getElementById('cContentType').value,
                cu_content_min: document.getElementById('cuContentMin').value || null,
                cu_content_max: document.getElementById('cuContentMax').value || null,
                cu_content_type: document.getElementById('cuContentType').value,
                moisture_min: document.getElementById('moistureMin').value || null,
                moisture_max: document.getElementById('moistureMax').value || null,
                moisture_type: document.getElementById('moistureType').value,
                ash_min: document.getElementById('ashMin').value || null,
                ash_max: document.getElementById('ashMax').value || null,
                ash_type: document.getElementById('ashType').value,
                sinter_change_rate_min: document.getElementById('sinterChangeRateMin').value || null,
                sinter_change_rate_max: document.getElementById('sinterChangeRateMax').value || null,
                sinter_change_rate_type: document.getElementById('sinterChangeRateType').value,
                sinter_strength_min: document.getElementById('sinterStrengthMin').value || null,
                sinter_strength_max: document.getElementById('sinterStrengthMax').value || null,
                sinter_strength_type: document.getElementById('sinterStrengthType').value,
                forming_strength_min: document.getElementById('formingStrengthMin').value || null,
                forming_strength_max: document.getElementById('formingStrengthMax').value || null,
                forming_strength_type: document.getElementById('formingStrengthType').value,
                forming_load_min: document.getElementById('formingLoadMin').value || null,
                forming_load_max: document.getElementById('formingLoadMax').value || null,
                forming_load_type: document.getElementById('formingLoadType').value,
                particle_size_type: document.getElementById('particleSizeType').value
            };

            try {
                const url = specId ? `${API_BASE}/api/admin/powder-spec/${specId}` : `${API_BASE}/api/admin/powder-spec`;
                const method = specId ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(powderData)
                });

                const data = await response.json();

                if (data.success) {
                    // 입도분석 데이터 저장
                    const particleType = document.getElementById('particleSizeType').value;
                    if (particleType !== '비활성') {
                        const particleSpecs = [];
                        const meshSizes = [
                            { id: '180', name: '+180 um' },
                            { id: '150', name: '+150 um' },
                            { id: '106', name: '+106 um' },
                            { id: '75', name: '+75 um' },
                            { id: '45', name: '+45 um' },
                            { id: '45m', name: '-45 um' }
                        ];

                        meshSizes.forEach(mesh => {
                            const minVal = document.getElementById(`particle_${mesh.id}_min`).value;
                            const maxVal = document.getElementById(`particle_${mesh.id}_max`).value;
                            if (minVal && maxVal) {
                                particleSpecs.push({
                                    powder_name: powderName,
                                    mesh_size: mesh.name,
                                    min_value: parseFloat(minVal),
                                    max_value: parseFloat(maxVal)
                                });
                            }
                        });

                        // 입도분석 규격 저장
                        if (particleSpecs.length > 0) {
                            await fetch(`${API_BASE}/api/admin/particle-size/bulk`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    powder_name: powderName,
                                    specs: particleSpecs
                                })
                            });
                        }
                    }

                    alert('저장되었습니다.');
                    hidePowderForm();
                    loadPowderSpecs(powderSpecMode);
                    loadParticlePowderList();
                    // 검사 페이지의 분말 목록도 갱신
                    loadPowderList('incoming');
                    loadPowderList('mixing');
                } else {
                    alert('저장 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        });
        }

        async function deletePowderSpec(specId, powderName) {
            if (!confirm(`'${powderName}' 분말을 삭제하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE}/api/admin/powder-spec/${specId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    alert('삭제되었습니다.');
                    loadPowderSpecs(powderSpecMode);
                    loadParticlePowderList();
                } else {
                    alert('삭제 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // ============================================
        // 입도분석 규격 관리
        // ============================================

        async function loadParticlePowderList() {
            try {
                const response = await fetch(`${API_BASE}/api/powder-list`);
                const data = await response.json();

                const select = document.getElementById('particlePowderSelect');
                if (!select) {
                    console.warn('particlePowderSelect 요소를 찾을 수 없습니다.');
                    return;
                }

                select.innerHTML = '<option value="">분말을 선택하세요</option>';

                if (data.success) {
                    data.data.forEach(powder => {
                        const option = document.createElement('option');
                        option.value = powder;
                        option.textContent = powder;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                console.error('분말 목록 로딩 실패:', error);
            }
        }

        async function loadParticleSpecs() {
            const powderName = document.getElementById('particlePowderSelect').value;

            if (!powderName) {
                document.getElementById('particleList').innerHTML = `<div class="empty-message">${t('selectPowderPlaceholder')}</div>`;
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/api/admin/particle-size/${powderName}`);
                const data = await response.json();

                const listDiv = document.getElementById('particleList');

                if (data.success && data.data.length > 0) {
                    let html = `<table><tr><th>${t('meshSize')}</th><th>${t('minValue')} (%)</th><th>${t('maxValue')} (%)</th><th>${t('action')}</th></tr>`;

                    data.data.forEach(spec => {
                        html += `
                            <tr>
                                <td>${spec.mesh_size}</td>
                                <td>${spec.min_value}</td>
                                <td>${spec.max_value}</td>
                                <td>
                                    <button class="btn secondary" onclick="editParticleSpec(${spec.id})" style="padding: 8px 12px; margin-right: 5px;">${t('edit')}</button>
                                    <button class="btn danger" onclick="deleteParticleSpec(${spec.id}, '${spec.mesh_size}')" style="padding: 8px 12px;">${t('delete')}</button>
                                </td>
                            </tr>
                        `;
                    });

                    html += '</table>';
                    listDiv.innerHTML = html;
                } else {
                    listDiv.innerHTML = `<div class="empty-message">${t('noParticleSpecs')}</div>`;
                }
            } catch (error) {
                console.error('입도분석 규격 로딩 실패:', error);
            }
        }

        function showAddParticleForm() {
            const powderName = document.getElementById('particlePowderSelect').value;
            if (!powderName) {
                alert('먼저 분말을 선택하세요.');
                return;
            }

            document.getElementById('particleFormTitle').textContent = t('addParticleSpec');
            document.getElementById('particleSpecId').value = '';
            document.getElementById('particleForm').reset();
            document.getElementById('particleFormContainer').style.display = 'block';
        }

        function hideParticleForm() {
            document.getElementById('particleFormContainer').style.display = 'none';
            document.getElementById('particleForm').reset();
        }

        async function editParticleSpec(specId) {
            try {
                const powderName = document.getElementById('particlePowderSelect').value;
                const response = await fetch(`${API_BASE}/api/admin/particle-size/${powderName}`);
                const data = await response.json();

                if (data.success) {
                    const spec = data.data.find(s => s.id === specId);
                    if (spec) {
                        document.getElementById('particleFormTitle').textContent = t('editParticleSpec');
                        document.getElementById('particleSpecId').value = spec.id;
                        document.getElementById('particleMeshSize').value = spec.mesh_size;
                        document.getElementById('particleMinValue').value = spec.min_value;
                        document.getElementById('particleMaxValue').value = spec.max_value;
                        document.getElementById('particleFormContainer').style.display = 'block';
                    }
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        const particleFormElement = document.getElementById('particleForm');


        if (particleFormElement) {


            particleFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();

            const specId = document.getElementById('particleSpecId').value;
            const powderName = document.getElementById('particlePowderSelect').value;
            const particleData = {
                powder_name: powderName,
                mesh_size: document.getElementById('particleMeshSize').value,
                min_value: document.getElementById('particleMinValue').value,
                max_value: document.getElementById('particleMaxValue').value
            };

            try {
                const url = specId ? `${API_BASE}/api/admin/particle-size/${specId}` : `${API_BASE}/api/admin/particle-size`;
                const method = specId ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(particleData)
                });

                const data = await response.json();

                if (data.success) {
                    alert('저장되었습니다.');
                    hideParticleForm();
                    loadParticleSpecs();
                } else {
                    alert('저장 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        });
        }

        async function deleteParticleSpec(specId, meshSize) {
            if (!confirm(`'${meshSize}' 규격을 삭제하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE}/api/admin/particle-size/${specId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    alert('삭제되었습니다.');
                    loadParticleSpecs();
                } else {
                    alert('삭제 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // ============================================
        // 검사자 관리
        // ============================================

        async function loadInspectors() {
            try {
                const response = await fetch(`${API_BASE}/api/admin/inspector`);
                const data = await response.json();

                const listDiv = document.getElementById('inspectorList');

                if (data.success && data.data.length > 0) {
                    let html = `<table><tr><th>${t('inspectorName')}</th><th>${t('action')}</th></tr>`;

                    data.data.forEach(inspector => {
                        html += `
                            <tr>
                                <td>${inspector.name}</td>
                                <td>
                                    <button class="btn danger" onclick="deleteInspector(${inspector.id}, '${inspector.name}')" style="padding: 8px 12px;">${t('delete')}</button>
                                </td>
                            </tr>
                        `;
                    });

                    html += '</table>';
                    listDiv.innerHTML = html;
                } else {
                    listDiv.innerHTML = `<div class="empty-message">${t('noInspectors')}</div>`;
                }
            } catch (error) {
                console.error('검사자 목록 로딩 실패:', error);
            }
        }

        async function addInspector() {
            const name = document.getElementById('newInspectorName').value.trim();

            if (!name) {
                alert('검사자 이름을 입력하세요.');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/api/admin/inspector`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name })
                });

                const data = await response.json();

                if (data.success) {
                    alert('추가되었습니다.');
                    document.getElementById('newInspectorName').value = '';
                    loadInspectors();
                } else {
                    alert('추가 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function deleteInspector(inspectorId, name) {
            if (!confirm(`'${name}' 검사자를 삭제하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE}/api/admin/inspector/${inspectorId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    alert('삭제되었습니다.');
                    loadInspectors();
                } else {
                    alert('삭제 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // ============================================
        // 작업자 관리
        // ============================================

        async function loadOperators() {
            try {
                const response = await fetch(`${API_BASE}/api/admin/operator`);
                const data = await response.json();

                const listDiv = document.getElementById('operatorList');

                if (data.success && data.data.length > 0) {
                    let html = `<table><tr><th>${t('operatorName')}</th><th>${t('action')}</th></tr>`;

                    data.data.forEach(operator => {
                        html += `
                            <tr>
                                <td>${operator.name}</td>
                                <td>
                                    <button class="btn danger" onclick="deleteOperator(${operator.id}, '${operator.name}')" style="padding: 8px 12px;">${t('delete')}</button>
                                </td>
                            </tr>
                        `;
                    });

                    html += '</table>';
                    listDiv.innerHTML = html;
                } else {
                    listDiv.innerHTML = `<div class="empty-message">${t('noOperators')}</div>`;
                }
            } catch (error) {
                console.error('작업자 목록 로딩 실패:', error);
            }
        }

        async function addOperator() {
            const name = document.getElementById('newOperatorName').value.trim();

            if (!name) {
                alert('작업자 이름을 입력하세요.');
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/api/admin/operator`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name })
                });

                const data = await response.json();

                if (data.success) {
                    alert('추가되었습니다.');
                    document.getElementById('newOperatorName').value = '';
                    loadOperators();
                } else {
                    alert('추가 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function deleteOperator(operatorId, name) {
            if (!confirm(`'${name}' 작업자를 삭제하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE}/api/admin/operator/${operatorId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    alert('삭제되었습니다.');
                    loadOperators();
                } else {
                    alert('삭제 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // ============================================
        // Recipe(배합 규격서) 관리
        // ============================================

        let recipeLineCount = 0;

        async function loadProductRecipes() {
            try {
                const response = await fetch(`${API_BASE}/api/admin/recipes`);
                const data = await response.json();

                const listDiv = document.getElementById('productList');

                if (data.success && data.data.length > 0) {
                    let html = '<table class="data-table" style="width:100%"><thead><tr><th>제품명</th><th>제품코드</th><th>REV</th><th>규격서</th><th>작업</th></tr></thead><tbody>';

                    data.data.forEach((product, index) => {
                        const totalRatio = product.recipes.reduce((sum, r) => sum + parseFloat(r.ratio || 0), 0);
                        const productNameEscaped = product.product_name.replace(/'/g, "\\'");
                        const currentRev = product.rev || '';
                        const specFileName = product.spec_file_name || '';

                        // 규격서 열: 파일이 있으면 열람/삭제 버튼, 없으면 업로드 버튼
                        let specHtml = '';
                        if (specFileName) {
                            specHtml = `
                                <a href="${API_BASE}/api/admin/product-spec/download/${encodeURIComponent(product.product_name)}" target="_blank"
                                   style="color: #4FC3F7; text-decoration: none; font-size: 0.85em; margin-right: 6px;" title="${specFileName}">
                                    📄 ${specFileName.length > 15 ? specFileName.substring(0, 15) + '...' : specFileName}
                                </a>
                                <button class="btn danger" onclick="deleteSpecFile('${productNameEscaped}')" style="padding: 2px 8px; font-size: 0.8em;">✕</button>`;
                        } else {
                            specHtml = `
                                <label style="cursor: pointer; padding: 4px 10px; background: #F07D00; color: #fff; border-radius: 4px; font-size: 0.85em;">
                                    📎 업로드
                                    <input type="file" accept=".pdf" style="display:none;" onchange="uploadSpecFile('${productNameEscaped}', this)">
                                </label>`;
                        }

                        html += `
                            <tr>
                                <td style="padding: 12px;">${product.product_name}</td>
                                <td style="padding: 12px;">${product.product_code || '-'}</td>
                                <td style="padding: 12px; min-width: 100px;">
                                    <input type="text" value="${currentRev}" placeholder="예: 01"
                                           style="width: 60px; padding: 4px 8px; text-align: center; background: #2C2C2C; color: #E0E0E0; border: 1px solid #555; border-radius: 4px;"
                                           onchange="saveProductRev('${productNameEscaped}', this.value)">
                                </td>
                                <td style="padding: 12px; min-width: 180px;">
                                    ${specHtml}
                                </td>
                                <td style="padding: 12px;">
                                    <button class="btn" onclick="toggleProductDetail('${productNameEscaped}', ${index})" id="viewBtn_${index}" style="padding: 6px 12px; margin-right: 5px; background: #F07D00;">조회</button>
                                    <button class="btn primary" onclick="editProduct('${productNameEscaped}')" style="padding: 6px 12px; margin-right: 5px;">수정</button>
                                    <button class="btn danger" onclick="deleteProduct('${productNameEscaped}')" style="padding: 6px 12px;">삭제</button>
                                </td>
                            </tr>
                            <tr id="detailRow_${index}" style="display: none;">
                                <td colspan="5" style="padding: 0; background: #1E1E1E;">
                                    <div style="padding: 20px; border-left: 4px solid #F07D00;">
                                        <h4 style="margin: 0 0 15px 0; color: #F07D00;">배합 구성</h4>
                                        <table style="width: 100%; font-size: 0.9em;">
                                            <tr style="background: rgba(66, 165, 245, 0.1);">
                                                <th style="padding: 10px;">${t('powderName')}</th>
                                                <th style="padding: 10px;">${t('category')}</th>
                                                <th style="padding: 10px;">${t('ratio')} (%)</th>
                                                <th style="padding: 10px;">${t('toleranceMinus')} (g)</th>
                                                <th style="padding: 10px;">${t('tolerancePlus')} (g)</th>
                                                <th style="padding: 10px;">Main</th>
                                            </tr>`;

                        product.recipes.forEach(recipe => {
                            const categoryBadge = recipe.powder_category === 'incoming'
                                ? `<span class="badge" style="background: #F07D00;">${t('incoming')}</span>`
                                : `<span class="badge" style="background: #F07D00;">${t('mixing')}</span>`;

                            const isMainBadge = recipe.is_main
                                ? '<span style="color: #D06E00; font-weight: 600;">✓</span>'
                                : '-';

                            html += `
                                <tr>
                                    <td style="padding: 8px;">${recipe.powder_name}</td>
                                    <td style="padding: 8px;">${categoryBadge}</td>
                                    <td style="padding: 8px;">${formatTwo(recipe.ratio)}%</td>
                                    <td style="padding: 8px;">-${recipe.tolerance_minus !== undefined ? recipe.tolerance_minus : 5}</td>
                                    <td style="padding: 8px;">+${recipe.tolerance_plus !== undefined ? recipe.tolerance_plus : 5}</td>
                                    <td style="padding: 8px; text-align: center;">${isMainBadge}</td>
                                </tr>`;
                        });

                        html += `
                                            <tr style="font-weight: bold; background: #2C2C2C;">
                                                <td style="padding: 10px;">${t('totalRatio')}</td>
                                                <td colspan="4" style="padding: 10px;">${totalRatio.toFixed(2)}%</td>
                                            </tr>
                                        </table>
                                    </div>
                                </td>
                            </tr>`;
                    });

                    html += '</tbody></table>';
                    listDiv.innerHTML = html;
                } else {
                    listDiv.innerHTML = `<div class="empty-message">${t('noProducts')}</div>`;
                }
            } catch (error) {
                console.error('Recipe 목록 로딩 실패:', error);
            }
        }

        // REV 저장
        async function saveProductRev(productName, rev) {
            try {
                const response = await fetch(`${API_BASE}/api/admin/product-spec/rev`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_name: productName, rev: rev })
                });
                const data = await response.json();
                if (!data.success) {
                    alert('REV 저장 실패: ' + data.message);
                }
            } catch (error) {
                alert('REV 저장 오류: ' + error.message);
            }
        }

        // 규격서 PDF 업로드
        async function uploadSpecFile(productName, inputElement) {
            const file = inputElement.files[0];
            if (!file) return;

            if (!file.name.toLowerCase().endsWith('.pdf')) {
                alert('PDF 파일만 업로드 가능합니다.');
                inputElement.value = '';
                return;
            }

            const formData = new FormData();
            formData.append('product_name', productName);
            formData.append('file', file);

            try {
                const response = await fetch(`${API_BASE}/api/admin/product-spec/upload`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (data.success) {
                    loadProductRecipes(); // 테이블 새로고침
                } else {
                    alert('업로드 실패: ' + data.message);
                }
            } catch (error) {
                alert('업로드 오류: ' + error.message);
            }
            inputElement.value = '';
        }

        // 규격서 PDF 삭제
        async function deleteSpecFile(productName) {
            if (!confirm('규격서 파일을 삭제하시겠습니까?')) return;

            try {
                const response = await fetch(`${API_BASE}/api/admin/product-spec/delete-file`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_name: productName })
                });
                const data = await response.json();

                if (data.success) {
                    loadProductRecipes(); // 테이블 새로고침
                } else {
                    alert('삭제 실패: ' + data.message);
                }
            } catch (error) {
                alert('삭제 오류: ' + error.message);
            }
        }

        function toggleProductDetail(productName, index) {
            const detailRow = document.getElementById(`detailRow_${index}`);
            const viewBtn = document.getElementById(`viewBtn_${index}`);

            if (detailRow.style.display === 'none') {
                detailRow.style.display = 'table-row';
                viewBtn.textContent = '닫기';
                viewBtn.style.background = '#D06E00';
            } else {
                detailRow.style.display = 'none';
                viewBtn.textContent = '조회';
                viewBtn.style.background = '#F07D00';
            }
        }

        async function showAddProductForm() {
            document.getElementById('productFormTitle').textContent = t('addNewProduct');
            document.getElementById('recipeProductName').value = '';
            document.getElementById('recipeProductName').readOnly = false; // 새 제품 추가 시 수정 가능
            document.getElementById('recipeProductCode').value = '';
            document.getElementById('recipeLines').innerHTML = '';
            recipeLineCount = 0;

            // 초기 Recipe 라인 1개 추가 (await로 분말 목록 로드 완료 대기)
            await addRecipeLine();

            document.getElementById('productFormContainer').style.display = 'block';
        }

        function hideProductForm() {
            document.getElementById('productFormContainer').style.display = 'none';
        }

        async function editProduct(productName) {
            try {
                // 제품의 Recipe 데이터 가져오기
                const response = await fetch(`${API_BASE}/api/admin/recipes?product_name=${encodeURIComponent(productName)}`);
                const data = await response.json();

                if (!data.success || !data.data || data.data.length === 0) {
                    alert('제품 정보를 찾을 수 없습니다.');
                    return;
                }

                const product = data.data[0]; // 첫 번째 제품 (제품명으로 필터링했으므로 1개만 있음)

                // 폼 제목 변경
                document.getElementById('productFormTitle').textContent = t('editProduct');

                // 제품 정보 입력
                document.getElementById('recipeProductName').value = product.product_name;
                document.getElementById('recipeProductName').readOnly = true; // 제품명은 수정 불가
                document.getElementById('recipeProductCode').value = product.product_code || '';

                // 기존 Recipe 라인 제거
                document.getElementById('recipeLines').innerHTML = '';
                recipeLineCount = 0;

                // 각 Recipe 라인 추가 및 데이터 채우기
                for (const recipe of product.recipes) {
                    await addRecipeLine();

                    // 방금 추가된 라인 (마지막 라인)
                    const lines = document.querySelectorAll('.recipe-line');
                    const lastLine = lines[lines.length - 1];

                    // 데이터 채우기
                    lastLine.querySelector('.recipe-powder-name').value = recipe.powder_name;
                    lastLine.querySelector('.recipe-ratio').value = formatTwo(recipe.ratio);
                    lastLine.querySelector('.recipe-tolerance-minus').value = recipe.tolerance_minus !== undefined ? recipe.tolerance_minus : 5;
                    lastLine.querySelector('.recipe-tolerance-plus').value = recipe.tolerance_plus !== undefined ? recipe.tolerance_plus : 5;

                    // Main 분말 체크
                    if (recipe.is_main) {
                        lastLine.querySelector('.recipe-is-main').checked = true;
                    }
                }

                // 폼을 해당 제품 card 바로 아래로 이동
                const formContainer = document.getElementById('productFormContainer');
                const productCard = document.querySelector(`.product-card[data-product-name="${productName}"]`);

                if (productCard && formContainer) {
                    // 폼을 productCard 바로 다음에 삽입
                    productCard.insertAdjacentElement('afterend', formContainer);
                }

                // 폼 표시
                formContainer.style.display = 'block';

            } catch (error) {
                alert('오류: ' + error.message);
                console.error('Edit product error:', error);
            }
        }

        async function addRecipeLine() {
            const container = document.getElementById('recipeLines');
            const lineId = recipeLineCount++;

            // 수입검사용 분말 목록 가져오기
            let powderOptions = '<option value="">' + t('selectPlaceholder') + '</option>';
            try {
                const response = await fetch(`${API_BASE}/api/powders?category=incoming`);
                const data = await response.json();
                if (data.success && data.powders) {
                    data.powders.forEach(powder => {
                        powderOptions += `<option value="${powder.powder_name}">${powder.powder_name}</option>`;
                    });
                }
            } catch (error) {
                console.error('Failed to load powder list:', error);
            }

            const lineHtml = `
                <div class="recipe-line" data-line-id="${lineId}" style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 80px 60px; gap: 10px; margin-bottom: 10px; padding: 10px; background: white; border-radius: 5px; color: #000;">
                    <div class="form-group">
                        <label>${t('powderName')} *</label>
                        <select class="recipe-powder-name" required>
                            ${powderOptions}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>${t('ratio')} (%) *</label>
                        <input type="number" step="0.01" class="recipe-ratio" required placeholder="60.00">
                    </div>
                    <div class="form-group">
                        <label>${t('toleranceMinus')} (g) *</label>
                        <input type="number" step="0.1" class="recipe-tolerance-minus" required placeholder="5" value="5">
                    </div>
                    <div class="form-group">
                        <label>${t('tolerancePlus')} (g) *</label>
                        <input type="number" step="0.1" class="recipe-tolerance-plus" required placeholder="5" value="5">
                    </div>
                    <div class="form-group" style="display: flex; align-items: end;">
                        <label style="display: flex; align-items: center; gap: 5px; margin-bottom: 0; cursor: pointer;">
                            <input type="checkbox" class="recipe-is-main" value="${lineId}">
                            <span style="font-size: 0.9em;">Main</span>
                        </label>
                    </div>
                    <div style="display: flex; align-items: end;">
                        <button type="button" class="btn danger" onclick="removeRecipeLine(${lineId})" style="padding: 10px; width: 100%;">×</button>
                    </div>
                </div>`;

            container.insertAdjacentHTML('beforeend', lineHtml);

            // 방금 추가된 체크박스에 이벤트 리스너 추가
            const newCheckbox = container.querySelector(`[data-line-id="${lineId}"] .recipe-is-main`);
            if (newCheckbox) {
                newCheckbox.addEventListener('change', function() {
                    const checkedBoxes = document.querySelectorAll('.recipe-is-main:checked');
                    if (checkedBoxes.length > 2) {
                        this.checked = false;
                        alert('Main 분말은 최대 2개까지만 선택할 수 있습니다.');
                    }
                });
            }
        }

        function removeRecipeLine(lineId) {
            const line = document.querySelector(`[data-line-id="${lineId}"]`);
            if (line) line.remove();
        }

        const productFormElement = document.getElementById('productForm');


        if (productFormElement) {


            productFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();

            const productName = document.getElementById('recipeProductName').value.trim();
            const productCode = document.getElementById('recipeProductCode').value.trim();

            // 제품명 확인
            if (!productName) {
                alert('제품명을 입력하세요.');
                return;
            }

            // Recipe 라인 수집
            const lines = document.querySelectorAll('.recipe-line');

            // Recipe 라인 존재 확인
            if (lines.length === 0) {
                alert('배합 구성을 최소 1개 이상 추가하세요.');
                return;
            }

            const recipes = [];

            // Main 분말 확인 (체크박스로 변경, 최대 2개)
            const mainCheckboxes = document.querySelectorAll('.recipe-is-main:checked');
            const mainLineIds = Array.from(mainCheckboxes).map(cb => cb.value);

            lines.forEach(line => {
                const powderName = line.querySelector('.recipe-powder-name').value.trim();
                const ratio = line.querySelector('.recipe-ratio').value;
                const toleranceMinus = line.querySelector('.recipe-tolerance-minus').value;
                const tolerancePlus = line.querySelector('.recipe-tolerance-plus').value;
                const lineId = line.getAttribute('data-line-id');
                const isMain = mainLineIds.includes(lineId);

                // 필수 항목 확인
                if (powderName && ratio && toleranceMinus && tolerancePlus) {
                    recipes.push({
                        product_name: productName,
                        product_code: productCode,
                        powder_name: powderName,
                        powder_category: 'incoming',  // 항상 수입검사용 분말
                        ratio: parseFloat(ratio),
                        target_weight: null,
                        tolerance_minus: parseFloat(toleranceMinus),
                        tolerance_plus: parseFloat(tolerancePlus),
                        is_main: isMain
                    });
                }
            });

            // 유효한 Recipe가 있는지 확인
            if (recipes.length === 0) {
                alert('분말명과 비율을 입력하세요.');
                return;
            }

            // 비율 합계 확인
            const totalRatio = recipes.reduce((sum, r) => sum + r.ratio, 0);
            if (Math.abs(totalRatio - 100) > 0.1) {
                alert(`배합 비율의 합계가 100%가 아닙니다. 현재: ${totalRatio.toFixed(1)}%\n\n각 분말의 비율을 조정하여 합계가 100%가 되도록 해주세요.`);
                return;
            }

            try {
                // 수정 모드인지 확인 (제품명 필드가 readOnly이면 수정 모드)
                const isEditMode = document.getElementById('recipeProductName').readOnly;

                if (isEditMode) {
                    // 수정 모드: 기존 Recipe 삭제 후 새로 추가
                    const deleteResponse = await fetch(`${API_BASE}/api/admin/recipe/product/${encodeURIComponent(productName)}`, {
                        method: 'DELETE'
                    });

                    const deleteData = await deleteResponse.json();
                    if (!deleteData.success) {
                        throw new Error('기존 Recipe 삭제 실패: ' + deleteData.message);
                    }
                }

                // 각 Recipe를 개별적으로 저장
                for (const recipe of recipes) {
                    const response = await fetch(`${API_BASE}/api/admin/recipe`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(recipe)
                    });

                    const data = await response.json();
                    if (!data.success) {
                        throw new Error(data.message);
                    }
                }

                alert(isEditMode ? '수정되었습니다.' : '저장되었습니다.');
                hideProductForm();
                loadProductRecipes();
            } catch (error) {
                alert('저장 실패: ' + error.message);
            }
        });
        }

        async function deleteProduct(productName) {
            if (!confirm(`'${productName}' 제품의 모든 Recipe를 삭제하시겠습니까?`)) return;

            try {
                const response = await fetch(`${API_BASE}/api/admin/recipe/product/${encodeURIComponent(productName)}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    alert('삭제되었습니다.');
                    loadProductRecipes();
                } else {
                    alert('삭제 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // ============================================
        // 배합 작업 (Blending Work)
        // ============================================

        let currentRecipe = null;
        let currentProductCode = '';

        async function loadBlendingPage() {
            // 목록 먼저 보이도록 폼 숨김
            hideBlendingForm();

            await loadProductsForBlending();
            await loadOperatorList();
            await generateAndSetBatchLot();

                // 작업지시서에서 시작한 경우 정보 자동 입력
                checkAndFillBlendingOrderInfo();

                // 이 화면에서도 작업지시서 목록을 보여주고 작업 시작 가능
                if (typeof loadBlendingOrdersForBlending === 'function') {
                    await loadBlendingOrdersForBlending();
                }

                // 진행중인 배합작업 목록 로드
                await loadInProgressBlendingWorks();
        }

        // --------------------------------------------
        // 진행중인 배합작업 목록 로드
        // --------------------------------------------
        async function loadInProgressBlendingWorks() {
            try {
                const response = await fetch(`${API_BASE}/api/blending/works?status=in_progress`);
                const data = await response.json();

                const tbody = document.getElementById('inProgressBlendingWorks');
                if (!tbody) return;

                if (!data.success || !data.works || data.works.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="empty-message">진행중인 배합작업이 없습니다.</td></tr>';
                    return;
                }

                tbody.innerHTML = data.works.map(work => {
                    const startTime = work.start_time ? new Date(work.start_time).toLocaleString('ko-KR') : '-';

                    // 진행률 계산 (투입된 원재료 수 / 전체 원재료 수)
                    const progress = work.material_input_count || 0;
                    const total = work.total_materials || 0;
                    const progressPercent = total > 0 ? Math.round((progress / total) * 100) : 0;

                    return `
                        <tr>
                            <td>${work.work_order || '-'}</td>
                            <td>${work.product_name}</td>
                            <td><strong>${work.batch_lot}</strong></td>
                            <td>${work.operator || '-'}</td>
                            <td>${startTime}</td>
                            <td>${progress}/${total} (${progressPercent}%)</td>
                            <td>
                                <button class="btn" onclick="loadAutoInputPage(${work.id}, 'blending')" style="padding: 6px 12px; font-size: 0.9em; background:#4CAF50; color:white; border:none; border-radius:4px; margin-right: 5px;">
                                    작업 계속
                                </button>
                                <button class="btn danger" onclick="deleteBlendingWork(${work.id}, '${work.batch_lot}')" style="padding: 6px 12px; font-size: 0.9em;">
                                    삭제
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            } catch (error) {
                console.error('진행중인 배합작업 로드 실패:', error);
                const tbody = document.getElementById('inProgressBlendingWorks');
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="7" class="empty-message">오류 발생: ' + error.message + '</td></tr>';
                }
            }
        }

        // --------------------------------------------
        // 배합검사 페이지: 완료된 배합작업 목록 로드
        // --------------------------------------------
        async function loadMixingPage() {
            try {
                const response = await fetch(`${API_BASE}/api/blending/works?status=completed`);
                const data = await response.json();

                const container = document.getElementById('mixingCompletedList');
                if (!container) return;

                if (!data.success || !data.works || data.works.length === 0) {
                    container.innerHTML = '<div class="empty-message">완료된 배합작업이 없습니다.</div>';
                    return;
                }

                // 검사 완료된 작업 필터링 (검사 미완료 또는 진행 중만 표시)
                const unfinishedWorks = data.works.filter(work => work.inspection_status !== 'completed');

                if (unfinishedWorks.length === 0) {
                    container.innerHTML = '<div class="empty-message">검사 대기 중인 배합작업이 없습니다.</div>';
                    return;
                }

                let html = '<table class="data-table" style="width:100%"><thead><tr><th>작업지시번호</th><th>제품명</th><th>배합 LOT</th><th>작업자</th><th>완료시간</th><th>작업</th></tr></thead><tbody>';

                unfinishedWorks.forEach(work => {
                    const endTime = work.end_time ? new Date(work.end_time).toLocaleString('ko-KR') : '-';

                    // 검사 상태에 따라 버튼/아이콘 표시
                    let actionHtml = '';
                    if (work.inspection_status === 'completed') {
                        // 검사 완료된 경우
                        if (work.inspection_result === 'pass') {
                            actionHtml = '<span style="font-size:24px;color:#4CAF50;">✅</span> <span style="color:#4CAF50;font-weight:600;">합격</span>';
                        } else if (work.inspection_result === 'fail') {
                            actionHtml = '<span style="font-size:24px;color:#EF5350;">❌</span> <span style="color:#EF5350;font-weight:600;">불합격</span>';
                        } else {
                            actionHtml = '<span style="color:#A0A0A0;">검사완료</span>';
                        }
                    } else if (work.inspection_status === 'in_progress') {
                        // 검사 진행 중 - 이어하기 버튼 표시
                        actionHtml = `<button class="btn" onclick="continueInspection('${work.product_name}', '${work.batch_lot}', 'mixing')" style="padding:6px 10px; background:#F07D00; color:#E8E8E8;">⏳ 검사 이어하기</button>`;
                    } else {
                        // 검사 미시작
                        actionHtml = `<button class="btn primary" onclick="startBlendingInspectionFromMixing('${work.batch_lot}', '${work.product_name}')" style="padding:6px 10px;">🔧 배합검사</button>`;
                    }

                    html += `
                        <tr>
                            <td>${work.work_order || '-'}</td>
                            <td>${work.product_name}</td>
                            <td><strong>${work.batch_lot}</strong></td>
                            <td>${work.operator || '-'}</td>
                            <td>${endTime}</td>
                            <td style="white-space:nowrap;">${actionHtml}</td>
                        </tr>
                    `;
                });

                html += '</tbody></table>';
                container.innerHTML = html;
            } catch (err) {
                console.error('mixing 목록 로딩 실패:', err);
                const container = document.getElementById('mixingCompletedList');
                if (container) container.innerHTML = '<div class="empty-message">목록을 불러올 수 없습니다.</div>';
            }
        }

        // 배합검사 시작 (mixing 페이지에서 클릭)
        function startBlendingInspectionFromMixing(batchLot, productName) {
            // 바로 검사 시작 API 호출과 검사 페이지 노출
            startInspection(productName, batchLot, '일상점검', '', 'mixing');
        }

        function checkAndFillBlendingOrderInfo() {
            const orderId = sessionStorage.getItem('blendingOrderId');
            const productName = sessionStorage.getItem('blendingOrderProduct');
            const workOrderNumber = sessionStorage.getItem('blendingOrderNumber');

            if (orderId && productName && workOrderNumber) {
                // 제품명 자동 선택 및 고정(선택 불가)
                const productSelect = document.getElementById('blendingProductName');
                if (productSelect) {
                    // 옵션에서 일치하는 값이 있으면 선택
                    let found = false;
                    for (let i = 0; i < productSelect.options.length; i++) {
                        if (productSelect.options[i].value === productName) {
                            productSelect.selectedIndex = i;
                            found = true;
                            break;
                        }
                    }
                    // 값이 없더라도 value에 설정
                    if (!found) {
                        productSelect.value = productName;
                    }

                    // 제품명을 고정하여 선택 기능 제거
                    productSelect.disabled = true;
                    productSelect.setAttribute('data-fixed', 'true');
                    productSelect.style.background = '#2C2C2C';

                    // change 이벤트 트리거 (레시피 로드)
                    productSelect.dispatchEvent(new Event('change', { bubbles: true }));

                    // 제품 선택 시 Recipe 자동 로드 (안전하게 호출)
                    if (typeof loadRecipeForProduct === 'function') {
                        loadRecipeForProduct();
                    }
                }

                // 작업지시번호 표시 (읽기 전용으로)
                const workOrderInput = document.getElementById('blendingWorkOrder');
                if (workOrderInput) {
                    workOrderInput.value = workOrderNumber;
                    workOrderInput.setAttribute('readonly', 'readonly');
                    workOrderInput.style.background = '#2C2C2C';
                }

                // sessionStorage 클리어 (한 번만 사용)
                // sessionStorage.removeItem('blendingOrderId');
                // sessionStorage.removeItem('blendingOrderProduct');
                // sessionStorage.removeItem('blendingOrderNumber');
            }
        }

        function hideBlendingForm() {
            const card = document.getElementById('blendingFormCard');
            if (card) card.style.display = 'none';

            // 목록 카드들 다시 표시
            const orderListCard = document.getElementById('blendingOrderListCard');
            const inProgressCard = document.getElementById('inProgressWorksCard');
            const backBtn = document.getElementById('backToOrderListBtn');

            if (orderListCard) orderListCard.style.display = 'block';
            if (inProgressCard) inProgressCard.style.display = 'block';
            if (backBtn) backBtn.style.display = 'none';
        }

        function showBlendingForm() {
            const card = document.getElementById('blendingFormCard');
            if (card) card.style.display = 'block';

            // 목록 카드들 숨기기
            const orderListCard = document.getElementById('blendingOrderListCard');
            const inProgressCard = document.getElementById('inProgressWorksCard');
            const backBtn = document.getElementById('backToOrderListBtn');

            if (orderListCard) orderListCard.style.display = 'none';
            if (inProgressCard) inProgressCard.style.display = 'none';
            if (backBtn) backBtn.style.display = 'block';
        }

        function showOrderListView() {
            // 폼 숨기고 목록 표시
            hideBlendingForm();
            // 폼 초기화
            const form = document.getElementById('blendingForm');
            if (form) form.reset();
        }

        async function loadProductsForBlending() {
            try {
                const response = await fetch(`${API_BASE}/api/blending/products`);
                const data = await response.json();

                const select = document.getElementById('blendingProductName');
                // 제품 목록 로드 시 잠금 해제(직접 선택 가능하게)
                select.disabled = false;
                select.removeAttribute('data-fixed');
                select.style.background = '';

                select.innerHTML = '<option value="">선택하세요</option>';

                if (data.success && data.data.length > 0) {
                    data.data.forEach(product => {
                        const option = document.createElement('option');
                        option.value = product.product_name;
                        option.dataset.productCode = product.product_code || '';
                        option.textContent = product.product_name;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                console.error('제품 목록 로딩 실패:', error);
            }
        }

        async function loadOperatorList() {
            try {
                const response = await fetch(`${API_BASE}/api/operator-list`);
                const data = await response.json();

                const select = document.getElementById('blendingOperator');
                select.innerHTML = '<option value="">선택하세요</option>';

                if (data.success) {
                    data.data.forEach(operator => {
                        const option = document.createElement('option');
                        option.value = operator;
                        option.textContent = operator;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                console.error('작업자 목록 로딩 실패:', error);
            }
        }

        async function generateAndSetBatchLot() {
            try {
                const response = await fetch(`${API_BASE}/api/blending/generate-lot`);
                const data = await response.json();

                if (data.success) {
                    document.getElementById('blendingBatchLot').value = data.batch_lot;
                }
            } catch (error) {
                console.error('배합 LOT 생성 실패:', error);
            }
        }

        async function loadRecipeForProduct() {
            const select = document.getElementById('blendingProductName');
            const productName = select.value;

            if (!productName) {
                document.getElementById('recipePreview').style.display = 'none';
                currentRecipe = null;
                return;
            }

            // 제품 코드 저장
            const selectedOption = select.options[select.selectedIndex];
            currentProductCode = selectedOption.dataset.productCode || '';

            try {
                const response = await fetch(`${API_BASE}/api/blending/recipe/${encodeURIComponent(productName)}`);
                const data = await response.json();

                if (data.success && data.data.length > 0) {
                    currentRecipe = data.data;
                    renderRecipePreview(data.data);
                } else {
                    alert('해당 제품의 Recipe가 없습니다.');
                    currentRecipe = null;
                }
            } catch (error) {
                alert('Recipe 로딩 실패: ' + error.message);
                currentRecipe = null;
            }
        }

        function renderRecipePreview(recipes) {
            const container = document.getElementById('recipePreviewContent');
            const blendingWeight = parseFloat(document.getElementById('blendingTargetWeight').value) || 0;

            // Main 분말들 찾기
            const mainRecipes = recipes.filter(r => r.is_main);

            // 총 Main 중량은 배합중량을 기준으로 함 (Option A)
            const totalMainWeight = blendingWeight;

            // Main 분말 비율 합계
            const totalMainRatio = mainRecipes.reduce((sum, r) => sum + r.ratio, 0);

            let html = '<table style="width: 100%; font-size: 0.9em;">';
            html += `<tr>
                <th>${t('powderName')}</th>
                <th>${t('category')}</th>
                <th>${t('ratio')} (%)</th>
                <th>${t('calculatedWeight')} (kg)</th>
            </tr>`;

            recipes.forEach(recipe => {
                let calculatedWeightDisplay = '-';

                if (mainRecipes.length > 0) {
                    // 메인 분말이 존재할 때
                    if (recipe.is_main) {
                        // main이 한 개면 전체 배합중량을 할당, 여러개면 ratio로 분배
                        if (mainRecipes.length === 1) {
                            recipe.calculated_weight = totalMainWeight;
                            calculatedWeightDisplay = formatNumber(totalMainWeight.toFixed(3));
                        } else if (totalMainRatio > 0) {
                            const w = totalMainWeight * (recipe.ratio / totalMainRatio);
                            recipe.calculated_weight = w;
                            calculatedWeightDisplay = formatNumber(w.toFixed(3));
                        }
                    } else {
                        // 비주 분말: 총 Main 중량(=배합중량)을 기준으로 비율대로 계산
                        if (totalMainRatio > 0) {
                            const w = totalMainWeight * (recipe.ratio / totalMainRatio);
                            recipe.calculated_weight = w;
                            calculatedWeightDisplay = formatNumber(w.toFixed(3));
                        }
                    }
                } else {
                    // Main 분말이 없을 때는 기존 방식 - 배합중량 기준 비율로 계산
                    const w = blendingWeight * (recipe.ratio / 100);
                    recipe.calculated_weight = w;
                    calculatedWeightDisplay = formatNumber(w.toFixed(3));
                }

                const categoryBadge = recipe.powder_category === 'incoming'
                    ? `<span class="badge" style="background: #F07D00;">${t('incoming')}</span>`
                    : `<span class="badge" style="background: #F07D00;">${t('mixing')}</span>`;

                const mainBadge = recipe.is_main ? ' <span class="badge" style="background: #D06E00; font-size: 0.75em;">MAIN</span>' : '';

                html += `<tr>
                    <td>${recipe.powder_name}${mainBadge}</td>
                    <td>${categoryBadge}</td>
                    <td>${formatTwo(recipe.ratio)}%</td>
                    <td>${calculatedWeightDisplay}</td>
                </tr>`;
            });

            html += '</table>';
            container.innerHTML = html;
            document.getElementById('recipePreview').style.display = 'block';

            // Note: start 폼에서는 Main 분말 중량을 별도 입력하지 않으므로, 상세 투입 화면에서 TOn 선택을 하도록 합니다.
        }

        function renderMainPowderWeightSelectors(mainRecipes) {
            const container = document.getElementById('mainPowderWeightsContainer');

            if (!mainRecipes || mainRecipes.length === 0) {
                container.style.display = 'none';
                container.innerHTML = '';
                return;
            }

            let html = '';
            mainRecipes.forEach((recipe, index) => {
                html += `
                    <div class="form-group">
                        <label>${recipe.powder_name} 중량 (ton) *</label>
                        <select id="mainPowderWeight_${index}" class="main-powder-weight-select" data-powder-name="${recipe.powder_name}" required>
                            <option value="">선택하세요</option>
                            <option value="1000">1 ton (1,000 kg)</option>
                            <option value="2000">2 ton (2,000 kg)</option>
                            <option value="3000">3 ton (3,000 kg)</option>
                            <option value="4000">4 ton (4,000 kg)</option>
                            <option value="5000">5 ton (5,000 kg)</option>
                        </select>
                    </div>
                `;
            });

            // 합계 검증 메시지 영역
            if (mainRecipes.length > 1) {
                html += `
                    <div id="mainPowderWeightValidation" style="padding: 10px; margin-bottom: 10px; background: rgba(255, 179, 0, 0.15); border-radius: 5px; font-size: 0.9em;">
                        <strong>⚠️ 중요:</strong> Main 분말 중량의 합계가 배합중량과 일치해야 합니다.
                        <div id="mainPowderWeightSum" style="margin-top: 5px; font-weight: bold;"></div>
                    </div>
                `;
            }

            container.innerHTML = html;
            container.style.display = 'block';

            // Main 분말 중량 변경 시 이벤트 리스너 추가
            const weightSelects = container.querySelectorAll('.main-powder-weight-select');
            weightSelects.forEach(select => {
                select.addEventListener('change', () => {
                    updateMainPowderWeightValidation(mainRecipes);
                    if (currentRecipe) {
                        renderRecipePreview(currentRecipe);
                    }
                });
            });

            updateMainPowderWeightValidation(mainRecipes);
        }

        function updateMainPowderWeightValidation(mainRecipes) {
            if (!mainRecipes || mainRecipes.length <= 1) return;

            const blendingWeight = parseFloat(document.getElementById('blendingTargetWeight').value) || 0;
            let totalMainWeight = 0;
            let allSelected = true;

            mainRecipes.forEach((recipe, index) => {
                const select = document.getElementById(`mainPowderWeight_${index}`);
                const weight = select ? parseFloat(select.value) || 0 : 0;
                totalMainWeight += weight;
                if (!select || !select.value) {
                    allSelected = false;
                }
            });

            const sumDiv = document.getElementById('mainPowderWeightSum');
            if (sumDiv && blendingWeight > 0 && allSelected) {
                const isValid = totalMainWeight === blendingWeight;
                sumDiv.innerHTML = `
                    Main 분말 합계: ${formatNumber(totalMainWeight)} kg / 배합중량: ${formatNumber(blendingWeight)} kg
                    ${isValid ? '<span style="color: green;">✓ 일치</span>' : '<span style="color: red;">✗ 불일치</span>'}
                `;
                sumDiv.style.color = isValid ? 'green' : 'red';
            } else if (sumDiv) {
                sumDiv.innerHTML = '';
            }
        }

        // 목표 총 중량 변경 시 Recipe 미리보기 업데이트
        const blendingTargetWeightElement = document.getElementById('blendingTargetWeight');

        if (blendingTargetWeightElement) {

            blendingTargetWeightElement.addEventListener('change', () => {
            if (currentRecipe) {
                const mainRecipes = currentRecipe.filter(r => r.is_main);
                updateMainPowderWeightValidation(mainRecipes);
                renderRecipePreview(currentRecipe);
            }
        });
        }

        // 배합 작업 폼 제출
        const blendingFormElement = document.getElementById('blendingForm');

        if (blendingFormElement) {

            blendingFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();

            const productName = document.getElementById('blendingProductName').value;
            const workOrder = document.getElementById('blendingWorkOrder').value;
            const batchLot = document.getElementById('blendingBatchLot').value;
            const targetWeight = document.getElementById('blendingTargetWeight').value;
            const operator = document.getElementById('blendingOperator').value;

            // 작업지시서 ID 가져오기 (있는 경우)
            const orderId = sessionStorage.getItem('blendingOrderId');

            if (!currentRecipe || currentRecipe.length === 0) {
                alert('제품을 선택하고 레시피를 확인해주세요.');
                return;
            }

            // Main 분말 중량은 작업지시서 화면에서 입력하지 않도록 변경됨.
            // 배합 작업 시작 후 원재료 투입 화면에서 Main 분말을 1~5 ton 중 선택할 수 있습니다.
            const mainRecipes = currentRecipe.filter(r => r.is_main);
            let mainPowderWeights = {};

            // 만약 start 화면에 값이 존재하면 전송(선택적)
            for (let i = 0; i < mainRecipes.length; i++) {
                const select = document.getElementById(`mainPowderWeight_${i}`);
                if (select && select.value) {
                    const weight = parseFloat(select.value);
                    if (!isNaN(weight)) mainPowderWeights[mainRecipes[i].powder_name] = weight;
                }
            }

            try {
                const requestBody = {
                    product_name: productName,
                    product_code: currentProductCode,
                    batch_lot: batchLot,
                    target_total_weight: parseFloat(targetWeight),
                    operator: operator,
                    main_powder_weights: mainPowderWeights  // Main 분말 중량 정보 추가
                };

                // 작업지시서 ID 추가 (있는 경우)
                if (orderId) {
                    requestBody.work_order_id = parseInt(orderId);
                }

                // 작업지시 번호 추가 (있는 경우)
                if (workOrder && !workOrder.includes('(자동)')) {
                    requestBody.work_order = workOrder;
                }

                const response = await fetch(`${API_BASE}/api/blending/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (data.success) {
                    alert(`배합 작업이 시작되었습니다.\n배합 LOT: ${data.batch_lot}`);
                    // 자동입력 페이지로 이동하면서 work_id 저장
                    sessionStorage.setItem('currentWorkId', data.work_id);
                    loadAutoInputPage(data.work_id, 'blending');
                } else {
                    alert('작업 시작 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        });
        }


        // 라벨 생성/렌더링: 우측 라벨 패널 제어 함수들
        function renderLabelPanel(work) {
            if (!work) return alert('라벨 정보를 불러올 수 없습니다.');

            const panel = document.getElementById('labelPanel');
            const list = document.getElementById('labelList');
            if (!panel || !list) return;

            // 초기화
            list.innerHTML = '';
            _labelDataCache = [];

            const targetWeight = Number(work.target_total_weight) || 0;
            const packSize = 1000; // 1 ton = 1000 kg
            const totalPacks = Math.max(1, Math.ceil(targetWeight / packSize));

            let labelIdx = 0; // 라벨 순번 (QR ID + 인쇄 인덱스용)
            for (let i = 1; i <= totalPacks; i++) {
                const isLast = (i === totalPacks);
                // 마지막 pack의 중량은 잔여중량
                let packWeight = packSize;
                if (isLast && (targetWeight % packSize) !== 0) {
                    const remainder = targetWeight - Math.floor(targetWeight / packSize) * packSize;
                    if (remainder > 0) packWeight = remainder;
                }

                // 팩당 2장 (앞/뒤 부착용)
                for (let copy = 0; copy < 2; copy++) {
                    labelIdx++;
                    const copyLabel = copy === 0 ? 'A' : 'B'; // 구분 표시

                    const labelDiv = document.createElement('div');
                    labelDiv.style.width = '150mm';
                    labelDiv.style.height = '100mm';
                    labelDiv.style.boxSizing = 'border-box';
                    labelDiv.style.background = 'white';
                    labelDiv.style.color = '#000';
                    labelDiv.style.border = '2px solid #000';
                    labelDiv.style.display = 'flex';
                    labelDiv.style.flexDirection = 'column';
                    labelDiv.style.justifyContent = 'space-between';
                    labelDiv.style.padding = '10px';
                    labelDiv.style.borderRadius = '4px';
                    labelDiv.style.position = 'relative';

                    const company = 'Johnson Electric Operations';
                    const product = work.product_name || '';
                    const batchLot = work.batch_lot || '';

                    const infoHtml = `
                        <div style="width:100%; height:100%; display:flex; flex-direction:column; justify-content:space-between;">
                            <!-- 상단: 회사명 -->
                            <div style="display:flex; justify-content:flex-start; align-items:flex-start; width:100%;">
                                <div style="font-weight:700; font-size:18px; text-align:left; color:#000;">${company}</div>
                            </div>

                            <!-- 중앙: 분말명 -->
                            <div style="display:flex; align-items:center; justify-content:center; width:100%; flex:1;">
                                <div style="font-weight:800; font-size:99px; text-align:center; line-height:1; color:#000;">${product}</div>
                            </div>

                            <!-- 하단: LOT, QR코드, Pack, Weight -->
                            <div style="display:flex; flex-direction:column; align-items:center; gap:4px; width:100%;">
                                <div style="font-size:28px; color:#000; font-weight:700;">Lot No : ${batchLot}</div>
                                <div id="label-qrcode-${labelIdx}" style="display:flex; justify-content:center; align-items:center; margin:4px 0;"></div>
                                <div style="font-size:18px; color:#000; font-weight:600; display:flex; gap:40px; justify-content:center; width:100%;">
                                    <span>Net Weight : ${formatNumber(packWeight)}kg</span>
                                    <span>Pack : ${i}/${totalPacks} (${copyLabel})</span>
                                </div>
                                <div style="display:flex; gap:6px; justify-content:center; width:100%; margin-top:4px;">
                                    <button class="btn" onclick="printLabel(${labelIdx})">인쇄</button>
                                </div>
                            </div>
                        </div>
                    `;

                    labelDiv.innerHTML = infoHtml;
                    list.appendChild(labelDiv);

                    // QR코드 생성: 전체 텍스트 사용 (제품명-LOT번호)
                    // 예: JEO.06.254-261224-001
                    const qrcodeValue = `${product}-${batchLot}`;

                    // render QR code into div (라이브러리 로드 대기 후 실행)
                    (function generateQR(labelIndex, value, attempt) {
                        setTimeout(() => {
                            try {
                                const qrcodeEl = document.getElementById(`label-qrcode-${labelIndex}`);
                                if (qrcodeEl && typeof QRCode === 'function') {
                                    qrcodeEl.innerHTML = '';
                                    new QRCode(qrcodeEl, {
                                        text: value,
                                        width: 113,
                                        height: 113,
                                        colorDark: "#000000",
                                        colorLight: "#ffffff",
                                        correctLevel: QRCode.CorrectLevel.H
                                    });
                                    console.log('QR코드 생성 성공:', value);
                                } else if (attempt < 10) {
                                    console.log(`QRCode 라이브러리 대기 중... (${attempt + 1}/10)`);
                                    generateQR(labelIndex, value, attempt + 1);
                                } else {
                                    console.error('QRCode 라이브러리 로드 실패, 텍스트로 대체');
                                    if (qrcodeEl) {
                                        qrcodeEl.innerHTML = `<div style="font-size:10px; text-align:center;">${value}</div>`;
                                    }
                                }
                            } catch (err) {
                                console.error('QR코드 렌더링 오류:', err);
                            }
                        }, attempt === 0 ? 100 : 500);
                    })(labelIdx, qrcodeValue, 0);

                    // 에이전트 전송용 데이터 캐시
                    _labelDataCache.push({
                        productName: product,
                        batchLot: batchLot,
                        packWeight: packWeight,
                        packIndex: i,
                        totalPacks: totalPacks,
                        copyLabel: copyLabel
                    });
                } // end copy loop
            }

            // show panel
            panel.style.display = 'block';
            panel.setAttribute('aria-hidden', 'false');
        }

        function showBarcodePanel() {
            const panel = document.getElementById('labelPanel');
            if (panel) {
                panel.style.display = 'block';
                panel.setAttribute('aria-hidden', 'false');

                // 라벨이 비어있으면 생성
                const labelList = document.getElementById('labelList');
                if (labelList && labelList.children.length === 0) {
                    // 완료된 작업의 라벨 재생성
                    if (currentBlendingWork && currentBlendingWork.status === 'completed') {
                        renderLabelPanel(currentBlendingWork);
                    }
                }
            }
        }

        function hideLabelPanel() {
            const panel = document.getElementById('labelPanel');
            if (panel) {
                panel.style.display = 'none';
                panel.setAttribute('aria-hidden', 'true');
            }
        }

        async function printLabel(index) {
            // 로컬 프린터 에이전트를 통해 큰 라벨 + 작은 라벨 동시 출력
            const labelData = _labelDataCache[index - 1];
            if (labelData) {
                try {
                    const resp = await fetch('http://localhost:9100/print', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(labelData)
                    });
                    const result = await resp.json();
                    if (result.success) {
                        alert(`인쇄 완료\n큰 라벨: ${result.results.large}\n작은 라벨: ${result.results.small}`);
                        return;
                    } else {
                        const errMsg = Object.values(result.results || {}).join('\n');
                        alert(`인쇄 오류:\n${errMsg}\n\n브라우저 인쇄로 대체합니다.`);
                    }
                } catch (e) {
                    console.warn('프린터 에이전트 연결 실패, 브라우저 인쇄로 대체:', e);
                }
            }

            // 폴백: 브라우저 창 인쇄 (큰 라벨만)
            const list = document.getElementById('labelList');
            const labelEl = list && list.children && list.children[index - 1];
            if (!labelEl) return alert('라벨을 찾을 수 없습니다.');

            // QR코드 이미지가 생성되었는지 확인
            const qrcodeDiv = labelEl.querySelector('div[id^="label-qrcode-"]');
            const qrcodeImg = qrcodeDiv ? qrcodeDiv.querySelector('img') : null;
            if (!qrcodeImg) {
                return alert('QR코드가 아직 생성되지 않았습니다. 잠시 후 다시 시도하세요.');
            }

            const content = labelEl.innerHTML;
            const w = window.open('', '_blank');
            if (!w) return alert('팝업 차단을 확인하세요.');

            const html = `
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>라벨 인쇄</title>
                    <style>
                        body { margin:0; padding:0; background:#fff; }
                        .label { width:150mm; height:100mm; display:flex; align-items:center; justify-content:center; }
                        .label > div { border: 2px solid #000; }
                        .label, .label * { color: #000 !important; }
                        button { display: none; }
                        @media print {
                            body, body * { background: #fff !important; }
                            .label, .label * { visibility: visible; color: #000 !important; }
                            button { display: none; }
                        }
                    </style>
                </head>
                <body>
                    <div class="label">${content}</div>
                    <script>
                        window.onload = function() {
                            // 모든 이미지 로드 완료 후 인쇄 (QR코드 포함)
                            var imgs = document.querySelectorAll('img');
                            var loaded = 0;
                            var total = imgs.length;
                            if (total === 0) { window.print(); window.close(); return; }
                            function checkPrint() {
                                loaded++;
                                if (loaded >= total) { window.print(); window.close(); }
                            }
                            for (var i = 0; i < total; i++) {
                                if (imgs[i].complete) { checkPrint(); }
                                else {
                                    imgs[i].onload = checkPrint;
                                    imgs[i].onerror = checkPrint;
                                }
                            }
                            // 안전장치: 최대 3초 후 강제 인쇄
                            setTimeout(function(){ window.print(); window.close(); }, 3000);
                        };
                    <\/script>
                </body>
                </html>
            `;

            w.document.open();
            w.document.write(html);
            w.document.close();
        }

        async function printAllLabels() {
            const list = document.getElementById('labelList');
            if (!list || !list.children || list.children.length === 0) return alert('출력할 라벨이 없습니다.');

            // 로컬 에이전트를 통해 전체 라벨 순차 출력
            if (_labelDataCache.length > 0) {
                try {
                    const resp = await fetch('http://localhost:9100/status');
                    if (resp.ok) {
                        // 에이전트 실행 중: 라벨 순차 출력
                        let failCount = 0;
                        for (let i = 0; i < _labelDataCache.length; i++) {
                            try {
                                const r = await fetch('http://localhost:9100/print', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(_labelDataCache[i])
                                });
                                const result = await r.json();
                                if (!result.success) failCount++;
                            } catch (e) {
                                failCount++;
                            }
                        }
                        if (failCount === 0) {
                            alert(`전체 ${_labelDataCache.length}장 인쇄 완료 (큰 라벨 + 작은 라벨)`);
                        } else {
                            alert(`${_labelDataCache.length - failCount}장 성공, ${failCount}장 실패\n브라우저 인쇄로 대체합니다.`);
                        }
                        if (failCount === 0) return;
                    }
                } catch (e) {
                    console.warn('프린터 에이전트 연결 실패, 브라우저 인쇄로 대체:', e);
                }
            }

            // QR코드 이미지가 모두 생성되었는지 확인
            const allQrImgs = list.querySelectorAll('div[id^="label-qrcode-"] img');
            if (allQrImgs.length === 0) {
                return alert('QR코드가 아직 생성되지 않았습니다. 잠시 후 다시 시도하세요.');
            }

            // 모든 라벨을 하나의 인쇄 창에 페이지 나눔으로 출력
            const w = window.open('', '_blank');
            if (!w) return alert('팝업 차단을 확인하세요.');

            let labelsHtml = '';
            for (let i = 0; i < list.children.length; i++) {
                const labelEl = list.children[i];
                const content = labelEl.innerHTML;
                // 마지막 라벨이 아닌 경우 페이지 나눔 추가
                const pageBreak = (i < list.children.length - 1) ? 'page-break-after: always;' : '';
                labelsHtml += `<div class="label" style="${pageBreak}">${content}</div>`;
            }

            const html = `
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>라벨 전체 인쇄</title>
                    <style>
                        body { margin:0; padding:0; background:#fff; }
                        .label { width:150mm; height:100mm; display:flex; align-items:center; justify-content:center; box-sizing:border-box; }
                        .label > div { border: 2px solid #000; width:150mm; height:100mm; box-sizing:border-box; }
                        .label, .label * { color: #000 !important; }
                        button { display: none; }
                        @media print {
                            body { margin: 0; background: #fff !important; }
                            .label { page-break-inside: avoid; }
                            .label, .label * { color: #000 !important; }
                            button { display: none; }
                        }
                    </style>
                </head>
                <body>
                    ${labelsHtml}
                    <script>
                        window.onload = function() {
                            // 모든 이미지 로드 완료 후 인쇄 (QR코드 포함)
                            var imgs = document.querySelectorAll('img');
                            var loaded = 0;
                            var total = imgs.length;
                            if (total === 0) { window.print(); window.close(); return; }
                            function checkPrint() {
                                loaded++;
                                if (loaded >= total) { window.print(); window.close(); }
                            }
                            for (var i = 0; i < total; i++) {
                                if (imgs[i].complete) { checkPrint(); }
                                else {
                                    imgs[i].onload = checkPrint;
                                    imgs[i].onerror = checkPrint;
                                }
                            }
                            // 안전장치: 최대 5초 후 강제 인쇄
                            setTimeout(function(){ window.print(); window.close(); }, 5000);
                        };
                    <\/script>
                </body>
                </html>
            `;

            w.document.open();
            w.document.write(html);
            w.document.close();
        }

        // ============================================
        // 배합작업 조회 (Blending Work Log)
        // ============================================

        async function loadMixingPowderListForFilter() {
            // 배합작업 현황 조회 필터용 배합분말 목록 로드
            try {
                const response = await fetch(`${API_BASE}/api/admin/powder-spec?category=mixing`);
                const data = await response.json();

                const select = document.getElementById('filterProductName');
                if (!select) return;

                // 기존 옵션 유지하고 분말 목록 추가
                const currentValue = select.value;
                select.innerHTML = '<option value="">전체</option>';

                if (data.success && data.specs) {
                    data.specs.forEach(spec => {
                        const option = document.createElement('option');
                        option.value = spec.powder_name;
                        option.textContent = spec.powder_name;
                        select.appendChild(option);
                    });
                }

                // 이전 선택값 복원
                if (currentValue) {
                    select.value = currentValue;
                }
            } catch (error) {
                console.error('배합분말 목록 로딩 실패:', error);
            }
        }

        async function loadBlendingWorks() {
            try {
                const statusFilterEl = document.getElementById('blendingLogStatusFilter');
                const statusFilter = statusFilterEl ? statusFilterEl.value : 'completed';
                const completedDateFrom = document.getElementById('filterCompletedDateFrom') ? document.getElementById('filterCompletedDateFrom').value : '';
                const completedDateTo = document.getElementById('filterCompletedDateTo') ? document.getElementById('filterCompletedDateTo').value : '';
                const productName = document.getElementById('filterProductName') ? document.getElementById('filterProductName').value.trim() : '';
                const batchLot = document.getElementById('filterBatchLot') ? document.getElementById('filterBatchLot').value.trim() : '';

                const includeHiddenWorks = document.getElementById('showHiddenBlendingWorks')?.checked;

                let url = `${API_BASE}/api/blending/works?status=${encodeURIComponent(statusFilter)}`;
                if (completedDateFrom) url += `&completed_date_from=${encodeURIComponent(completedDateFrom)}`;
                if (completedDateTo) url += `&completed_date_to=${encodeURIComponent(completedDateTo)}`;
                if (productName) url += `&product_name=${encodeURIComponent(productName)}`;
                if (batchLot) url += `&batch_lot=${encodeURIComponent(batchLot)}`;
                if (includeHiddenWorks) url += `&include_hidden=true`;

                const response = await fetch(url);
                const data = await response.json();

                const tbody = document.getElementById('blendingWorksTableBody');
                if (!tbody) return;

                if (!data.success || !data.works || data.works.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="9" class="empty-message">배합작업 내역이 없습니다.</td></tr>';
                    return;
                }

                tbody.innerHTML = data.works.map(work => {
                    const isHidden = work.is_hidden == 1;
                    const statusClass = work.status === 'completed' ? 'completed' : 'in-progress';
                    const statusText = work.status === 'completed' ? '완료' : '진행중';
                    const startTime = work.start_time ? new Date(work.start_time).toLocaleString('ko-KR') : '-';
                    const endTime = work.end_time ? new Date(work.end_time).toLocaleString('ko-KR') : '-';
                    const hiddenBadge = isHidden ? ' <span style="background:#888;color:#fff;font-size:0.75em;padding:2px 6px;border-radius:4px;">숨김</span>' : '';

                    return `
                        <tr style="${isHidden ? 'opacity:0.6;' : ''}">
                            <td>${work.work_order}</td>
                            <td>${work.product_name}</td>
                            <td><strong>${work.batch_lot}</strong>${hiddenBadge}</td>
                            <td>${work.operator || '-'}</td>
                            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                            <td>${startTime}</td>
                            <td>${endTime}</td>
                            <td>
                                ${isHidden ?
                                    `<button class="btn secondary" onclick="restoreBlendingWork(${work.id})" style="padding: 6px 12px; font-size: 0.9em;">복원</button>` :
                                work.status === 'completed' ?
                                    `<div style="display: flex; gap: 5px;">
                                        <button class="btn" onclick="loadAutoInputPage(${work.id}, 'blending-log')" style="padding: 6px 12px; font-size: 0.9em; background:#F07D00; color:white; border:none; border-radius:4px;">
                                            입력현황
                                        </button>
                                        <button class="btn secondary" onclick="hideBlendingWork(${work.id}, '${work.batch_lot}')" style="padding: 6px 12px; font-size: 0.9em;">
                                            숨기기
                                        </button>
                                    </div>` :
                                    `<div style="display: flex; gap: 5px;">
                                        <button class="btn" onclick="continueBlendingWork(${work.id})" style="padding: 6px 12px; font-size: 0.9em; background:#F07D00; color:white; border:none; border-radius:4px;">
                                            작업 계속
                                        </button>
                                        <button class="btn secondary" onclick="hideBlendingWork(${work.id}, '${work.batch_lot}')" style="padding: 6px 12px; font-size: 0.9em;">
                                            숨기기
                                        </button>
                                    </div>`
                                }
                            </td>
                            <td style="text-align: center;">
                                ${work.status === 'completed' ?
                                    `<button class="btn" onclick="showBlendingBarcodeFromLog(${work.id})" style="padding: 8px 16px; font-size: 1.2em; background:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer;" title="바코드 출력">
                                        📊
                                    </button>` :
                                    '-'
                                }
                            </td>
                        </tr>
                    `;
                }).join('');

            } catch (error) {
                console.error('배합작업 목록 로딩 실패:', error);
                document.getElementById('blendingWorksTableBody').innerHTML =
                    '<tr><td colspan="9" class="empty-message">오류 발생: ' + error.message + '</td></tr>';
            }
        }

        function startBlendingInspection(batchLot, productName) {
            // 배합검사 페이지로 이동하면서 LOT 정보 전달
            sessionStorage.setItem('blendingInspectionLot', batchLot);
            sessionStorage.setItem('blendingInspectionProduct', productName);
            showPage('mixing');
        }

        function resetBlendingFilters() {
            const dateFromEl = document.getElementById('filterCompletedDateFrom');
            const dateToEl = document.getElementById('filterCompletedDateTo');
            const prodEl = document.getElementById('filterProductName');
            const lotEl = document.getElementById('filterBatchLot');
            const statusEl = document.getElementById('blendingLogStatusFilter');
            if (dateFromEl) dateFromEl.value = '';
            if (dateToEl) dateToEl.value = '';
            if (prodEl) prodEl.value = '';
            if (lotEl) lotEl.value = '';
            if (statusEl) statusEl.value = 'in_progress';
            loadBlendingWorks();
        }

        async function deleteBlendingWork(workId, batchLot) {

            if (!confirm(`배합 LOT "${batchLot}"를 삭제하시겠습니까?`)) {
                return;
            }

            try {
                const response = await fetch(`${API_BASE}/api/blending/work/${workId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });

                const data = await response.json();

                if (data.success) {
                    alert('배합 작업이 삭제되었습니다.');
                    loadBlendingWorks(); // 목록 새로고침
                    loadInProgressBlendingWorks(); // 진행중인 배합작업 목록도 새로고침
                } else {
                    alert('삭제 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function hideBlendingWork(workId, batchLot) {
            if (!confirm(`배합 LOT "${batchLot}"을(를) 숨기시겠습니까?`)) return;
            try {
                const resp = await fetch(`${API_BASE}/api/blending/work/${workId}/hide`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hide: true, hidden_by: currentUserId })
                });
                const data = await resp.json();
                if (!data.success) { alert('숨기기 실패: ' + (data.message || '')); return; }
                loadBlendingWorks();
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function restoreBlendingWork(workId) {
            if (!confirm('해당 배합작업을 복원하시겠습니까?')) return;
            try {
                const resp = await fetch(`${API_BASE}/api/blending/work/${workId}/hide`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hide: false })
                });
                const data = await resp.json();
                if (!data.success) { alert('복원 실패: ' + (data.message || '')); return; }
                loadBlendingWorks();
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        function continueBlendingWork(workId) {
            // 진행중인 배합 작업을 이어서 진행 (자동입력 페이지로 이동)
            if (!workId) {
                alert('유효한 작업 ID가 필요합니다.');
                return;
            }
            loadAutoInputPage(workId, 'blending');
        }

        async function showBlendingBarcodeFromLog(workId) {
            // 배합작업조회에서 바코드 아이콘 클릭 시 - 기존 라벨 패널 재사용
            try {
                // API로 work 데이터 가져오기
                const response = await fetch(`${API_BASE}/api/blending/work/${workId}`);
                const data = await response.json();

                if (!data.success || !data.work) {
                    alert('작업 정보를 불러올 수 없습니다.');
                    return;
                }

                const work = data.work;

                // 공통 모달 함수 호출
                showBarcodeModal(work);
            } catch (error) {
                console.error('바코드 조회 실패:', error);
                alert('바코드를 불러오는 중 오류가 발생했습니다: ' + error.message);
            }
        }

        function printMixingSmallLabel(productName, batchLot) {
            const qrValue = `${productName}-${batchLot}`;
            const w = window.open('', '_blank');
            if (!w) return alert('팝업 차단을 확인하세요.');

            const html = `
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>라벨 인쇄</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        html { overflow: hidden; max-height: 30mm; }
                        body { width: 40mm; height: 30mm; max-height: 30mm; overflow: hidden; background: #fff; display: flex; justify-content: center; align-items: center; }
                        .label {
                            width: 40mm;
                            height: 30mm;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            gap: 1mm;
                            font-family: Arial, sans-serif;
                            color: #000;
                            padding: 1mm;
                        }
                        .product-name {
                            font-size: 15.2pt;
                            font-weight: 700;
                            text-align: center;
                            word-break: break-all;
                            line-height: 1.2;
                        }
                        .lot-no {
                            font-size: 12.35pt;
                            font-weight: 600;
                            text-align: center;
                        }
                        #qrcode { display: flex; justify-content: center; align-items: center; }
                        @page { size: 40mm 30mm; margin: 0; }
                        @media print {
                            body { margin: 0; background: #fff; }
                            button { display: none; }
                        }
                    </style>
                </head>
                <body>
                    <div class="label">
                        <div class="product-name">${productName}</div>
                        <div id="qrcode"></div>
                        <div class="lot-no">LOT: ${batchLot}</div>
                    </div>
                    <script src="/static/js/qrcode.min.js"><\/script>
                    <script>
                        window.onload = function() {
                            new QRCode(document.getElementById('qrcode'), {
                                text: '${qrValue}',
                                width: 50,
                                height: 50,
                                colorDark: '#000000',
                                colorLight: '#ffffff',
                                correctLevel: QRCode.CorrectLevel.H
                            });
                            var imgs = document.querySelectorAll('img');
                            var total = imgs.length;
                            var loaded = 0;
                            function tryPrint() {
                                loaded++;
                                if (loaded >= total) { window.print(); window.close(); }
                            }
                            if (total === 0) { setTimeout(function(){ window.print(); window.close(); }, 500); return; }
                            for (var i = 0; i < total; i++) {
                                if (imgs[i].complete) tryPrint();
                                else { imgs[i].onload = tryPrint; imgs[i].onerror = tryPrint; }
                            }
                            setTimeout(function(){ window.print(); window.close(); }, 3000);
                        };
                    <\/script>
                </body>
                </html>
            `;

            w.document.open();
            w.document.write(html);
            w.document.close();
        }

        function showBarcodeModal(work) {
            // 바코드를 모달 형태로 가운데 표시 (원재료 투입 완료 & 배합작업조회 공통 사용)
            if (!work) {
                alert('작업 정보가 없습니다.');
                return;
            }

            // 기존 renderLabelPanel 함수로 라벨 생성
            renderLabelPanel(work);

            // 라벨 패널을 모달 형태로 표시
            const panel = document.getElementById('labelPanel');
            if (panel) {
                // 모달 배경 추가
                const modalBackdrop = document.createElement('div');
                modalBackdrop.id = 'barcodeModalBackdrop';
                modalBackdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; justify-content: center; align-items: center;';

                // 닫기 버튼 추가 (배경 클릭 시)
                modalBackdrop.onclick = function(e) {
                    if (e.target === modalBackdrop) {
                        closeBarcodeModal();
                    }
                };

                // 패널을 모달 안에 넣기
                document.body.appendChild(modalBackdrop);

                // 패널 스타일 조정 - 크기 키우기
                panel.style.position = 'fixed';
                panel.style.top = '50%';
                panel.style.left = '50%';
                panel.style.transform = 'translate(-50%, -50%)';
                panel.style.zIndex = '10000';
                panel.style.width = '90vw'; // 화면의 90% 너비
                panel.style.maxWidth = '1400px'; // 최대 1400px
                panel.style.height = 'auto'; // CSS 고정 100mm 해제 → 내용에 맞게 확장
                panel.style.minWidth = 'auto'; // CSS 고정 150mm 해제
                panel.style.maxHeight = '95vh'; // 화면의 95% 높이까지
                panel.style.overflowY = 'auto';
                panel.style.display = 'block';
                panel.style.background = 'white';
                panel.style.color = '#000';
                panel.style.padding = '20px';
                panel.style.borderRadius = '10px';
                panel.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
                panel.setAttribute('aria-hidden', 'false');

                // 닫기 버튼이 없으면 추가
                if (!panel.querySelector('.modal-close-btn')) {
                    const closeBtn = document.createElement('button');
                    closeBtn.className = 'modal-close-btn';
                    closeBtn.innerHTML = '&times;';
                    closeBtn.style.cssText = 'position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 32px; cursor: pointer; color: #333; z-index: 10001; width: 40px; height: 40px;';
                    closeBtn.onclick = closeBarcodeModal;
                    panel.insertBefore(closeBtn, panel.firstChild);
                }
            }
        }

        function closeBarcodeModal() {
            // 모달 배경 제거
            const backdrop = document.getElementById('barcodeModalBackdrop');
            if (backdrop) {
                backdrop.remove();
            }

            // 패널 원래대로 복원
            const panel = document.getElementById('labelPanel');
            if (panel) {
                panel.style.position = '';
                panel.style.top = '';
                panel.style.left = '';
                panel.style.transform = '';
                panel.style.zIndex = '';
                panel.style.width = '';
                panel.style.maxWidth = '';
                panel.style.height = '';
                panel.style.minWidth = '';
                panel.style.maxHeight = '';
                panel.style.overflowY = '';
                panel.style.background = '';
                panel.style.padding = '';
                panel.style.borderRadius = '';
                panel.style.boxShadow = '';
                panel.style.display = 'none';
                panel.setAttribute('aria-hidden', 'true');

                // 닫기 버튼 제거
                const closeBtn = panel.querySelector('.modal-close-btn');
                if (closeBtn) {
                    closeBtn.remove();
                }
            }
        }

        // ============================================
        // 추적성 조회 (Traceability)
        // ============================================

        // 추적성 조회용 제품명 목록 로드
        async function loadTraceabilityPowderList() {
            try {
                const selectEl = document.getElementById('traceabilityPowderName');
                if (!selectEl) return;

                // 기본 옵션만 남기고 초기화
                selectEl.innerHTML = '<option value="">선택 안함 (배합 LOT만 검색)</option>';

                // 1. 수입분말 목록 가져오기
                const powderResponse = await fetch(`${API_BASE}/api/powders`);
                const powderData = await powderResponse.json();

                if (powderData.success && powderData.powders) {
                    const incomingGroup = document.createElement('optgroup');
                    incomingGroup.label = '수입검사분말';

                    powderData.powders.forEach(powder => {
                        const option = document.createElement('option');
                        option.value = powder.powder_name;
                        option.textContent = powder.powder_name;
                        incomingGroup.appendChild(option);
                    });

                    if (incomingGroup.children.length > 0) {
                        selectEl.appendChild(incomingGroup);
                    }
                }

                // 2. 배합분말(제품) 목록 가져오기
                const productResponse = await fetch(`${API_BASE}/api/blending/products`);
                const productData = await productResponse.json();

                if (productData.success && productData.products) {
                    const blendingGroup = document.createElement('optgroup');
                    blendingGroup.label = '배합분말';

                    productData.products.forEach(product => {
                        const option = document.createElement('option');
                        option.value = product.product_name;
                        option.textContent = product.product_name;
                        blendingGroup.appendChild(option);
                    });

                    if (blendingGroup.children.length > 0) {
                        selectEl.appendChild(blendingGroup);
                    }
                }

            } catch (error) {
                console.error('제품명 목록 로드 실패:', error);
            }
        }

        const traceabilityFormElement = document.getElementById('traceabilityForm');


        if (traceabilityFormElement) {


            traceabilityFormElement.addEventListener('submit', async (e) => {
            e.preventDefault();

            const lotNumber = document.getElementById('traceabilityLotNumber').value.trim();
            const powderName = document.getElementById('traceabilityPowderName').value.trim();

            if (!lotNumber) {
                alert('LOT 번호를 입력하세요.');
                return;
            }

            try {
                // 1. 먼저 LOT 유형 확인
                let searchUrl = `${API_BASE}/api/traceability/search?lot_number=${encodeURIComponent(lotNumber)}`;
                if (powderName) {
                    searchUrl += `&powder_name=${encodeURIComponent(powderName)}`;
                }
                const searchResponse = await fetch(searchUrl);
                const searchData = await searchResponse.json();

                if (!searchData.success) {
                    document.getElementById('traceabilityResults').innerHTML = `
                        <div class="card">
                            <div class="empty-message">${searchData.message}</div>
                        </div>
                    `;
                    return;
                }

                // 2. LOT 유형에 따라 적절한 추적 수행
                const foundAs = searchData.found_as;

                if (foundAs.includes('batch_lot')) {
                    // 배합 LOT로 추적 (Backward Traceability)
                    await traceByBatchLot(lotNumber);
                } else if (foundAs.includes('material_lot')) {
                    // 원재료 LOT로 추적 (Forward Traceability)
                    await traceByMaterialLot(lotNumber, powderName);
                }

            } catch (error) {
                alert('오류: ' + error.message);
            }
        });
        }

        async function traceByBatchLot(batchLot) {
            try {
                const response = await fetch(`${API_BASE}/api/traceability/batch/${encodeURIComponent(batchLot)}`);
                const data = await response.json();

                if (!data.success) {
                    alert(data.message);
                    return;
                }

                renderBackwardTrace(data);
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        async function traceByMaterialLot(materialLot, powderName = '') {
            try {
                let apiUrl = `${API_BASE}/api/traceability/material/${encodeURIComponent(materialLot)}`;
                if (powderName) {
                    apiUrl += `?powder_name=${encodeURIComponent(powderName)}`;
                }
                const response = await fetch(apiUrl);
                const data = await response.json();

                if (!data.success) {
                    alert(data.message);
                    return;
                }

                renderForwardTrace(data);
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        function renderBackwardTrace(data) {
            const container = document.getElementById('traceabilityResults');
            const work = data.blending_work;
            const materials = data.material_inputs;

            const statusBadge = work.status === 'completed'
                ? '<span class="badge pass">완료</span>'
                : '<span class="badge" style="background: #F07D00;">진행중</span>';

            let html = `
                <div class="card" style="background: linear-gradient(135deg, #D06E00 0%, #F07D00 100%); color: white; margin-top: 20px;">
                    <h3 style="margin: 0 0 15px 0;">🔗 ${t('backwardTrace')}</h3>
                    <h2 style="margin: 0 0 20px 0;">${t('batchLotNumber')}: ${work.batch_lot}</h2>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('productName')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${work.product_name}</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('workOrderNumber')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${work.work_order}</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('operator')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${work.operator}</p>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 20px;">
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('targetTotalWeight')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${work.target_total_weight} kg</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('actualTotalWeight')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${work.actual_total_weight || '-'} kg</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">상태</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${statusBadge}</p>
                        </div>
                    </div>
                </div>

                <div class="card" style="margin-top: 20px;">
                    <h3 style="margin: 0 0 15px 0;">📦 ${t('materialInputHistory')}</h3>
                    <p style="color: #A0A0A0; margin-bottom: 20px;">${t('materialInputHistoryDesc')}</p>
            `;

            materials.forEach((material, index) => {
                const inspection = material.incoming_inspection;
                const isValid = material.is_valid;
                const validationBadge = isValid
                    ? '<span class="badge pass">정상</span>'
                    : '<span class="badge fail">허용오차 초과</span>';

                html += `
                    <div style="border: 2px solid #333; border-radius: 10px; padding: 20px; margin-bottom: 15px; background: #1E1E1E;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <h4 style="margin: 0; font-size: 1.1em;">${index + 1}. ${material.powder_name}</h4>
                            ${validationBadge}
                        </div>

                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 15px; background: white; padding: 15px; border-radius: 5px; color: #000;">
                            <div>
                                <p style="color: #A0A0A0; margin-bottom: 5px; font-size: 0.9em;">${t('materialLot')}</p>
                                <p style="font-weight: 600;">${material.material_lot}</p>
                            </div>
                            <div>
                                <p style="color: #A0A0A0; margin-bottom: 5px; font-size: 0.9em;">${t('targetWeight')}</p>
                                <p style="font-weight: 600;">${material.target_weight} kg</p>
                            </div>
                            <div>
                                <p style="color: #A0A0A0; margin-bottom: 5px; font-size: 0.9em;">${t('actualWeight')}</p>
                                <p style="font-weight: 600;">${material.actual_weight} kg</p>
                            </div>
                            <div>
                                <p style="color: #A0A0A0; margin-bottom: 5px; font-size: 0.9em;">${t('weightDeviation')}</p>
                                <p style="font-weight: 600; ${isValid ? 'color: #4CAF50;' : 'color: #EF5350;'}">${material.weight_deviation}%</p>
                            </div>
                        </div>

                        ${!isValid ? `<p style="color: #EF5350; margin-bottom: 15px; font-weight: 600;">⚠️ ${material.validation_message}</p>` : ''}

                        ${(() => {
                            const inspections = material.incoming_inspections || (inspection ? [inspection] : []);
                            if (inspections.length === 0) {
                                return '<p style="color: #EF5350;">⚠️ 수입검사 기록 없음</p>';
                            }
                            return inspections.map(insp => renderInspectionBlock(insp, inspections.length > 1)).join('');
                        })()}
                    </div>
                `;
            });

            html += '</div>';
            container.innerHTML = html;
        }

        // 수입검사 결과 블록 렌더 (회차 + 재검사 이력 포함)
        function renderInspectionBlock(insp, showLot = false) {
            const round      = insp.current_round || 1;
            const roundTag   = round > 1 ? `<span style="background:#F07D00;color:#fff;padding:1px 7px;border-radius:4px;font-size:0.75em;margin-left:6px;">${round}차 검사</span>` : '';
            const lotTag     = showLot ? ` — LOT: ${insp.lot_number}` : '';
            const borderColor = insp.final_result === 'PASS' ? '#4CAF50' : '#EF5350';

            // 항목별 측정값 (평균값 + 결과)
            const measureItems = [
                { label: '유동도',        prefix: 'flow_rate',        unit: 's/50g' },
                { label: '겉보기밀도',    prefix: 'apparent_density', unit: 'g/cm³' },
                { label: '탄소함량',      prefix: 'c_content',        unit: '%' },
                { label: '구리함량',      prefix: 'cu_content',       unit: '%' },
                { label: '수분',          prefix: 'moisture',         unit: '%' },
                { label: '회분',          prefix: 'ash',              unit: '%' },
                { label: '소결치수변화율', prefix: 'sinter_change_rate', unit: '%' },
                { label: '소결강도',      prefix: 'sinter_strength',  unit: 'MPa' },
                { label: '성형강도',      prefix: 'forming_strength', unit: 'N' },
                { label: '성형하중',      prefix: 'forming_load',     unit: 'MPa' },
            ];

            const measuredRows = measureItems
                .filter(item => insp[`${item.prefix}_avg`] != null && insp[`${item.prefix}_avg`] !== '')
                .map(item => {
                    const avg = insp[`${item.prefix}_avg`];
                    const res = insp[`${item.prefix}_result`];
                    const rc  = res === 'PASS' ? '#4CAF50' : '#EF5350';
                    return `<tr style="border-bottom:1px solid #2C2C2C;">
                        <td style="padding:5px 10px; color:#A0A0A0; font-size:0.85em;">${item.label}</td>
                        <td style="padding:5px 10px; font-weight:600; font-size:0.9em;">${avg} ${item.unit}</td>
                        <td style="padding:5px 10px;"><span style="color:${rc}; font-weight:700; font-size:0.85em;">${res || '-'}</span></td>
                    </tr>`;
                }).join('');

            // 입도분석
            const psResult = insp.particle_size_result;
            const psRow = psResult
                ? `<tr style="border-bottom:1px solid #2C2C2C;">
                    <td style="padding:5px 10px; color:#A0A0A0; font-size:0.85em;">입도분석</td>
                    <td style="padding:5px 10px; font-size:0.85em; color:#A0A0A0;">-</td>
                    <td style="padding:5px 10px;"><span style="color:${psResult === 'PASS' ? '#4CAF50' : '#EF5350'}; font-weight:700; font-size:0.85em;">${psResult}</span></td>
                  </tr>` : '';

            const measureBlock = (measuredRows || psRow)
                ? `<div style="margin-top:12px; border-top:1px solid #333; padding-top:10px;">
                    <table style="width:100%; border-collapse:collapse;">
                        <thead><tr style="color:#666; font-size:0.8em;">
                            <th style="padding:4px 10px; text-align:left; font-weight:400;">검사항목</th>
                            <th style="padding:4px 10px; text-align:left; font-weight:400;">평균값</th>
                            <th style="padding:4px 10px; text-align:left; font-weight:400;">결과</th>
                        </tr></thead>
                        <tbody>${measuredRows}${psRow}</tbody>
                    </table>
                  </div>` : '';

            const histBlock = renderInspectionHistoryBlock(insp);

            return `
                <div style="background:rgba(66,165,245,0.07); padding:14px; border-radius:6px; border-left:4px solid ${borderColor}; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:6px; margin-bottom:10px; flex-wrap:wrap;">
                        <span style="font-weight:700; color:#E8E8E8;">${t('incomingInspection')}${lotTag}</span>
                        ${roundTag}
                        <span class="badge ${insp.final_result === 'PASS' ? 'pass' : 'fail'}" style="margin-left:auto;">${insp.final_result || '-'}</span>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px;">
                        <div><p style="color:#A0A0A0;font-size:0.82em;margin-bottom:2px;">${t('inspector')}</p><p style="font-weight:600;font-size:0.92em;">${insp.inspector || '-'}</p></div>
                        <div><p style="color:#A0A0A0;font-size:0.82em;margin-bottom:2px;">${t('inspectionTime')}</p><p style="font-weight:600;font-size:0.92em;">${insp.inspection_time || '-'}</p></div>
                        <div><p style="color:#A0A0A0;font-size:0.82em;margin-bottom:2px;">검사 유형</p><p style="font-weight:600;font-size:0.92em;">${insp.inspection_type || '-'}</p></div>
                    </div>
                    ${measureBlock}
                    ${histBlock}
                </div>`;
        }

        // 재검사 이력 블록 (inspection_histories 배열이 있을 때 표시)
        function renderInspectionHistoryBlock(insp) {
            const hists = insp.inspection_histories || [];
            if (hists.length === 0) return '';
            const rows = hists.map(h => {
                const failed = (() => { try { return JSON.parse(h.failed_items || '[]').join(', ') || '-'; } catch { return '-'; } })();
                const rc = h.final_result === 'PASS' ? '#4CAF50' : '#EF5350';
                return `<tr style="border-bottom:1px solid #333;">
                    <td style="padding:5px 8px; text-align:center;">${h.round}차</td>
                    <td style="padding:5px 8px;">${h.inspection_date || '-'}</td>
                    <td style="padding:5px 8px;">${h.inspector || '-'}</td>
                    <td style="padding:5px 8px; color:#EF9A9A; font-size:0.88em;">${failed}</td>
                    <td style="padding:5px 8px;"><span style="color:${rc}; font-weight:700;">${h.final_result || '-'}</span></td>
                    <td style="padding:5px 8px; color:#A0A0A0; font-size:0.82em;">${h.retest_reason || ''}</td>
                </tr>`;
            }).join('');
            return `
                <div style="margin-top:12px; border-top:1px solid #333; padding-top:10px;">
                    <p style="font-size:0.82em; color:#A0A0A0; margin-bottom:6px;">🔄 검사 이력</p>
                    <table style="width:100%; border-collapse:collapse; font-size:0.82em;">
                        <thead><tr style="color:#777;">
                            <th style="padding:4px 8px;">회차</th><th style="padding:4px 8px;">검사일</th>
                            <th style="padding:4px 8px;">검사자</th><th style="padding:4px 8px;">NG 항목</th>
                            <th style="padding:4px 8px;">결과</th><th style="padding:4px 8px;">재검사 사유</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        }

        function renderForwardTrace(data) {
            const container = document.getElementById('traceabilityResults');
            const inspection = data.incoming_inspection;
            const usages = data.used_in_batches;

            const inspectionBadge = inspection.final_result === 'PASS'
                ? '<span class="badge pass">합격</span>'
                : '<span class="badge fail">불합격</span>';

            let html = `
                <div class="card" style="background: linear-gradient(135deg, #D06E00 0%, #F07D00 100%); color: white; margin-top: 20px;">
                    <h3 style="margin: 0 0 15px 0;">🔗 ${t('forwardTrace')}</h3>
                    <h2 style="margin: 0 0 20px 0;">${t('materialLot')}: ${inspection.lot_number}</h2>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('powderName')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${inspection.powder_name}</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('inspector')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${inspection.inspector}</p>
                        </div>
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('inspectionTime')}</p>
                            <p style="font-size: 1.2em; font-weight: 600;">${inspection.inspection_time}</p>
                        </div>
                    </div>
                    <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.3); display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
                        <div>
                            <p style="opacity: 0.9; margin-bottom: 5px;">${t('finalResult')}</p>
                            <p style="font-size: 1.3em; font-weight: 600;">${inspectionBadge}${inspection.current_round > 1 ? `<span style="font-size:0.75em; opacity:0.8; margin-left:8px;">(${inspection.current_round}차 검사)</span>` : ''}</p>
                        </div>
                    </div>
                </div>
                ${renderInspectionHistoryBlock(inspection)}

                <div class="card" style="margin-top: 20px;">
                    <h3 style="margin: 0 0 15px 0;">🏭 ${t('usageHistory')}</h3>
                    <p style="color: #A0A0A0; margin-bottom: 20px;">${t('usageHistoryDesc')}</p>
            `;

            if (usages.length === 0) {
                html += `<div class="empty-message">${t('noUsageHistory')}</div>`;
            } else {
                html += '<table style="width: 100%;"><tr><th>배합 LOT</th><th>제품명</th><th>작업지시</th><th>투입 중량</th><th>중량 편차</th><th>상태</th><th>작업일시</th></tr>';

                usages.forEach(usage => {
                    const statusBadge = usage.status === 'completed'
                        ? '<span class="badge pass">완료</span>'
                        : '<span class="badge" style="background: #F07D00;">진행중</span>';

                    const isValid = usage.is_valid;
                    const validationBadge = isValid
                        ? '<span class="badge pass">정상</span>'
                        : '<span class="badge fail">허용오차 초과</span>';

                    html += `
                        <tr>
                            <td><strong>${usage.batch_lot}</strong></td>
                            <td>${usage.product_name}</td>
                            <td>${usage.work_order}</td>
                            <td>${usage.actual_weight} kg</td>
                            <td>${usage.weight_deviation}% ${validationBadge}</td>
                            <td>${statusBadge}</td>
                            <td>${usage.start_time}</td>
                        </tr>
                    `;
                });

                html += '</table>';
            }

            html += '</div>';
            container.innerHTML = html;
        }

        // ============================================
        // 배합작업지시서 (Blending Orders)
        // ============================================

        function loadBlendingOrdersPage() {
            // 제품 목록 로드 (작업지시서 생성용)
            loadOrderProductList();
            // 작업일자 기본값 설정 (오늘 날짜)
            const today = new Date().toISOString().split('T')[0];
            const orderDateInput = document.getElementById('orderDate');
            if (orderDateInput) {
                orderDateInput.value = today;
            }
            // 작업지시서 목록 로드
            loadBlendingOrders();
        }

        async function loadOrderProductList() {
            try {
                const response = await fetch(`${API_BASE}/api/blending/products`);
                const data = await response.json();

                const select = document.getElementById('orderProductName');
                if (!select) return;

                select.innerHTML = '<option value="">제품 선택</option>';

                if (data.success && data.data && data.data.length > 0) {
                    data.data.forEach(product => {
                        select.innerHTML += `<option value="${product.product_name}">${product.product_name}</option>`;
                    });
                } else {
                    select.innerHTML += '<option value="" disabled>등록된 배합 레시피가 없습니다</option>';
                }
            } catch (error) {
                console.error('제품 목록 로딩 실패:', error);
            }
        }

        // 작업지시서용 Recipe 로드 (제품 선택 시)
        async function loadOrderRecipe() {
            const productName = document.getElementById('orderProductName')?.value;
            if (!productName) return;

            // 필요시 Recipe 정보를 표시할 수 있음
            // 현재는 제품 선택만 처리
        }

        // 작업지시서 생성 폼 제출
        const orderFormElement = document.getElementById('blendingOrderForm');
        if (orderFormElement) {
            orderFormElement.addEventListener('submit', async (e) => {
                e.preventDefault();

                const productName = document.getElementById('orderProductName').value;
                const totalWeight = document.getElementById('orderTotalWeight').value;
                const createdBy = document.getElementById('orderCreatedBy').value;
                const workDate = document.getElementById('orderDate') ? document.getElementById('orderDate').value : null;

                if (!productName || !totalWeight) {
                    alert('제품명과 총 목표중량을 입력하세요.');
                    return;
                }

                try {
                    const response = await fetch(`${API_BASE}/api/blending-orders`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            product_name: productName,
                            total_target_weight: parseFloat(totalWeight),
                            created_by: createdBy || '미지정',
                            work_date: workDate || null
                        })
                    });

                    const data = await response.json();

                    if (data.success) {
                        alert(`✓ ${data.message}`);
                        // 폼 초기화
                        e.target.reset();
                        // 목록 새로고침
                        loadBlendingOrders();
                    } else {
                        alert('작업지시서 생성 실패: ' + data.message);
                    }
                } catch (error) {
                    alert('오류: ' + error.message);
                }
            });
        }

        async function loadBlendingOrders() {
            try {
                const statusFilter = document.getElementById('orderStatusFilter')?.value || 'all';
                const dateFrom = document.getElementById('orderDateFrom')?.value || '';
                const dateTo = document.getElementById('orderDateTo')?.value || '';
                const includeHidden = document.getElementById('showHiddenOrders')?.checked || false;

                let url = `${API_BASE}/api/blending-orders?status=${statusFilter}`;
                if (dateFrom) url += `&date_from=${encodeURIComponent(dateFrom)}`;
                if (dateTo) url += `&date_to=${encodeURIComponent(dateTo)}`;
                if (includeHidden) url += `&include_hidden=true`;

                const response = await fetch(url);
                const data = await response.json();

                const container = document.getElementById('blendingOrdersList');
                if (!container) return;

                if (!data.success || !data.orders || data.orders.length === 0) {
                    container.innerHTML = '<div class="empty-message">작업지시서가 없습니다.</div>';
                    return;
                }

                let html = `
                    <table class="data-table" style="width: 100%;">
                        <thead>
                            <tr style="background: linear-gradient(135deg, #D06E00 0%, #F07D00 100%); color: white;">
                                <th style="padding: 15px; text-align: center;">생성일</th>
                                <th style="padding: 15px; text-align: center;">작업지시번호</th>
                                <th style="padding: 15px; text-align: center;">제품명</th>
                                <th style="padding: 15px; text-align: center;">총중량 (kg)</th>
                                <th style="padding: 15px; text-align: center;">진도율</th>
                                <th style="padding: 15px; text-align: center;">상태/액션</th>
                            </tr>
                        </thead>
                        <tbody>
                `;

                data.orders.forEach(order => {
                    const progressPercent = order.progress_percent || 0;
                    const isCompleted = order.status === 'completed' || progressPercent >= 100;
                    const isHidden = order.is_hidden === 1;

                    // 진도(톤 단위) UI
                    const progressBar = renderTonProgress(order.total_target_weight, order.completed_weight);

                    let rowBg = isCompleted ? '#1a2e1a' : 'var(--bg-card)';
                    if (isHidden) rowBg = '#2a2a1a';

                    const hiddenBadge = isHidden
                        ? '<span style="background:#888; color:#fff; font-size:11px; padding:2px 7px; border-radius:4px; margin-left:6px;">숨김</span>'
                        : '';

                    let actionHtml = '';
                    if (isHidden) {
                        actionHtml = `<button onclick="toggleHideBlendingOrder(${order.id}, false)" class="btn secondary" style="padding: 8px 12px; border-radius:4px;">복원</button>`;
                    } else if (isCompleted) {
                        actionHtml = '<span style="background: #4CAF50; color: white; padding: 8px 16px; border-radius: 5px; font-weight: 600;">✓ 완료</span>';
                    } else {
                        actionHtml = `<button onclick="toggleHideBlendingOrder(${order.id}, true)" class="btn secondary" style="padding: 8px 12px; border-radius:4px;">숨기기</button>`;
                    }

                    html += `
                        <tr style="background: ${rowBg}; border-bottom: 1px solid #333; ${isHidden ? 'opacity:0.65;' : ''}">
                            <td style="padding: 15px; text-align: center;">
                                ${order.created_date}
                            </td>
                            <td style="padding: 15px; text-align: center;">
                                ${order.work_order_number}${hiddenBadge}
                            </td>
                            <td style="padding: 15px; text-align: center; font-weight: 600; font-size: 1.1em;">
                                ${order.product_name}
                            </td>
                            <td style="padding: 15px; text-align: center; font-size: 1.1em; font-weight: 600;">
                                ${formatNumber(order.total_target_weight)} kg
                            </td>
                            <td style="padding: 15px;">
                                ${progressBar}
                            </td>
                            <td style="padding: 15px; text-align: center;">
                                ${actionHtml}
                            </td>
                        </tr>
                    `;
                });

                html += '</tbody></table>';
                container.innerHTML = html;

            } catch (error) {
                console.error('작업지시서 목록 로딩 실패:', error);
                const container = document.getElementById('blendingOrdersList');
                if (container) {
                    container.innerHTML = '<div class="empty-message">작업지시서 목록을 불러올 수 없습니다.</div>';
                }
            }
        }

        async function toggleHideBlendingOrder(orderId, hide) {
            const msg = hide ? '이 작업지시서를 숨기겠습니까?\n배합작업 화면에서도 표시되지 않습니다.' : '이 작업지시서를 복원하겠습니까?';
            if (!confirm(msg)) return;
            try {
                const resp = await fetch(`${API_BASE}/api/blending-orders/${orderId}/hide`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hide })
                });
                const data = await resp.json();
                if (!data.success) {
                    alert('처리 실패: ' + (data.message || '알 수 없는 오류'));
                    return;
                }
                loadBlendingOrders();
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        function resetOrderFilters() {
            const statusEl = document.getElementById('orderStatusFilter');
            const dateFromEl = document.getElementById('orderDateFrom');
            const dateToEl = document.getElementById('orderDateTo');
            const showHiddenEl = document.getElementById('showHiddenOrders');

            if (statusEl) statusEl.value = 'in_progress';
            if (dateFromEl) dateFromEl.value = '';
            if (dateToEl) dateToEl.value = '';
            if (showHiddenEl) showHiddenEl.checked = false;

            loadBlendingOrders();
        }

        // 배합 페이지에서 작업 시작을 위해 간단히 작업지시서 목록을 렌더링
        async function loadBlendingOrdersForBlending() {
            try {
                const response = await fetch(`${API_BASE}/api/blending-orders?status=in_progress`);
                const data = await response.json();

                const container = document.getElementById('blendingOrdersForBlending');
                if (!container) return;

                if (!data.success || !data.orders || data.orders.length === 0) {
                    container.innerHTML = '<div class="empty-message">진행중인 작업지시서가 없습니다.</div>';
                    return;
                }

                let html = '<table class="data-table" style="width:100%"><thead><tr><th>생성일</th><th>작업지시번호</th><th>제품명</th><th>총중량</th><th>진도</th><th>작업</th></tr></thead><tbody>';

                data.orders.forEach(order => {
                    const created = order.created_date || '-';
                    const workNo = order.work_order_number || '-';
                    const prod = order.product_name || '-';
                    const total = order.total_target_weight ? formatNumber(order.total_target_weight) + ' kg' : '-';
                    const prog = order.progress_percent || 0;

                    const progCell = renderTonProgress(order.total_target_weight, order.completed_weight);

                    html += `
                        <tr>
                            <td>${created}</td>
                            <td>${workNo}</td>
                            <td>${prod}</td>
                            <td>${total}</td>
                            <td>${progCell}</td>
                            <td>
                                <button class="btn primary" onclick="startBlendingFromOrder(${order.id}, '${escapeHtml(order.product_name || '')}', '${escapeHtml(order.work_order_number || '')}')" style="padding:6px 10px;">
                                    작업시작하기
                                </button>
                            </td>
                        </tr>`;
                });

                html += '</tbody></table>';
                container.innerHTML = html;

            } catch (err) {
                console.error('blending orders for blending 로딩 실패:', err);
                const container = document.getElementById('blendingOrdersForBlending');
                if (container) container.innerHTML = '<div class="empty-message">작업지시서 목록을 불러올 수 없습니다.</div>';
            }
        }

        // 간단한 HTML 이스케이프 (문자열을 속성/텍스트로 안전하게 사용)
        function escapeHtml(str) {
            if (!str && str !== 0) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        // 작업지시서 삭제
        async function deleteBlendingOrder(orderId) {
            if (!confirm('정말 해당 작업지시서를 삭제하시겠습니까?')) return;
            try {
                const resp = await fetch(`${API_BASE}/api/blending-orders/${orderId}`, { method: 'DELETE' });
                const data = await resp.json();
                if (!data.success) {
                    alert('삭제 실패: ' + (data.message || '알 수 없는 오류'));
                    return;
                }
                // 삭제 성공 시 목록 새로고침
                loadBlendingOrdersPage();
            } catch (error) {
                console.error('작업지시서 삭제 실패:', error);
                alert('작업지시서 삭제 중 오류가 발생했습니다. 콘솔을 확인하세요.');
            }
        }

        async function startBlendingFromOrder(orderId, productName, workOrderNumber) {
            // 배합작업 페이지로 이동 후 폼 표시 및 채우기
            showPage('blending');

            try {
                const resp = await fetch(`${API_BASE}/api/blending-orders/${orderId}`);
                const data = await resp.json();
                if (!data.success) {
                    alert('작업지시서 정보를 불러오지 못했습니다: ' + (data.message || ''));
                    return;
                }

                const order = data.order;

                // 제품 선택
                const productSelect = document.getElementById('blendingProductName');
                if (productSelect) {
                    // 시도해서 옵션을 선택, 없으면 값으로 설정
                    let found = false;
                    for (let i = 0; i < productSelect.options.length; i++) {
                        if (productSelect.options[i].value === order.product_name) {
                            productSelect.selectedIndex = i;
                            found = true;
                            break;
                        }
                    }
                    if (!found) productSelect.value = order.product_name;

                    // 제품명을 작업지시서 기준으로 고정(선택 불가)
                    productSelect.disabled = true;
                    productSelect.setAttribute('data-fixed', 'true');
                    productSelect.style.background = '#2C2C2C';

                    // change 이벤트 트리거 및 Recipe 로드
                    productSelect.dispatchEvent(new Event('change', { bubbles: true }));

                    // 세션에 작업지시 정보 저장(다른 경로에서 입장 시 활용)
                    try {
                        sessionStorage.setItem('blendingOrderId', String(order.id));
                        sessionStorage.setItem('blendingOrderProduct', String(order.product_name));
                        sessionStorage.setItem('blendingOrderNumber', String(order.work_order_number || ''));
                    } catch (e) { /* noop */ }
                }

                // 작업지시번호
                const workOrderInput = document.getElementById('blendingWorkOrder');
                if (workOrderInput) {
                    workOrderInput.value = order.work_order_number || '';
                    workOrderInput.setAttribute('readonly', 'readonly');
                    workOrderInput.style.background = '#2C2C2C';
                }

                // 목표중량은 항상 기본값(선택하세요)으로 설정
                const targetSelect = document.getElementById('blendingTargetWeight');
                if (targetSelect) {
                    targetSelect.value = '';
                }

                // operator 비워두기 (사용자가 선택)
                const opSelect = document.getElementById('blendingOperator');
                if (opSelect) opSelect.value = '';

                // batch lot은 새로 생성
                await generateAndSetBatchLot();

                // 보이기
                showBlendingForm();
            } catch (err) {
                console.error(err);
                alert('작업지시서 불러오기 중 오류가 발생했습니다.');
            }
        }

        // 숫자 포맷팅 함수 (천단위 콤마)
        function formatNumber(num) {
            if (num === null || num === undefined || num === '') return '';
            return Number(num).toLocaleString('ko-KR');
        }

        // 소수 둘째 자리 포맷(예: 60 -> "60.00")
        function formatTwo(num) {
            if (num === null || num === undefined || num === '') return '';
            const n = parseFloat(num);
            if (isNaN(n)) return '';
            return n.toFixed(2);
        }

        // 바코드 스캔 값 파싱 함수
        // 입력: "0636260115001" (숫자만)
        // 출력: { productDigits: "0636", lot: "260115-001", productNumber: "06.36" }
        // QR코드 파싱 함수 (전체 텍스트 사용으로 더 이상 필요 없음)
        // 이전 바코드(숫자만) 사용 시 필요했던 함수들
        // function parseBarcodeValue(barcodeValue) { ... }
        // async function findProductByNumber(productNumber) { ... }

        // 진도(톤 단위) 시각화: 네모칸으로 표현 (정수톤 기준, 소수 단위 미표시)
        function renderTonProgress(totalKg, completedKg) {
            const totalTons = Math.max(0, Math.ceil(Number(totalKg || 0) / 1000)); // 총 톤은 올림(작업계획에서 남는 부분도 칸으로 표시)
            const completedTons = Math.max(0, Math.floor(Number(completedKg || 0) / 1000)); // 완료는 정수톤 단위로만 채움

            // 최소 1칸 보장
            const totalBoxesRaw = Math.max(1, totalTons);
            const MAX_BOXES = 50; // 너무 많은 칸은 생략(표시 최대)
            const totalBoxes = Math.min(totalBoxesRaw, MAX_BOXES);

            // 표시할 채워진 박스 수 (정수톤 기준, 제한 반영)
            const fullBoxes = Math.min(totalBoxes, completedTons);

            let boxesHtml = '<div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">';
            for (let i = 0; i < totalBoxes; i++) {
                if (i < fullBoxes) {
                    boxesHtml += '<div style="width:18px;height:18px;border-radius:3px;background:#4CAF50;border:1px solid #444;"></div>';
                } else {
                    boxesHtml += '<div style="width:18px;height:18px;border-radius:3px;border:1px solid #444;background:#242424;"></div>';
                }
            }
            boxesHtml += '</div>';

            // 남은 톤: 소수점 표시는 하지 않음(올림으로 표시하여 안전하게 남은량을 보여줌)
            const remainingTonsInt = Math.max(0, Math.ceil((Number(totalKg || 0) / 1000) - (Number(completedKg || 0) / 1000)));
            const remainingText = `<div style="font-size:0.95em;font-weight:600;margin-top:6px;">남은: ${remainingTonsInt} ton</div>`;
            const note = totalBoxesRaw > MAX_BOXES ? `<div style="font-size:0.8em;color:#888;margin-top:4px;">(총 ${totalTons} ton, 표시 ${totalBoxes}칸)</div>` : '';

            return `<div style="display:flex;flex-direction:column;align-items:flex-start;">${boxesHtml}${remainingText}${note}</div>`;
        }

        // ============================================
        // 대시보드 함수
        // ============================================

        // 차트 객체 저장
        let charts = {
            blendingCompletion: null,
            mixingInspection: null,
            blendingByPowder: null,
            ngStatus: null
        };

        let dashboardPeriods = { completion: 'daily', inspection: 'daily', byPowder: 'today' };
        let dashboardRefreshTimer = null;

        // 대시보드 로드
        async function loadDashboard() {
            await loadDashboardKPI();
            await Promise.all([
                loadBlendingCompletionChart(dashboardPeriods.completion),
                loadMixingInspectionChart(dashboardPeriods.inspection),
                loadBlendingByPowderChart(dashboardPeriods.byPowder),
                loadNgInspections()
            ]);
            updateKpiColors();
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2, '0') + ':' +
                            now.getMinutes().toString().padStart(2, '0') + ':' +
                            now.getSeconds().toString().padStart(2, '0');
            const el = document.getElementById('dashboardLastUpdate');
            if (el) el.textContent = timeStr;
            startDashboardAutoRefresh();
        }

        function updateKpiColors() {
            const passRateEl = document.getElementById('kpiPassRate');
            if (passRateEl) {
                const val = parseFloat(passRateEl.textContent);
                if (!isNaN(val))
                    passRateEl.style.color = val >= 95 ? '#4CAF50' : val >= 80 ? '#FFA726' : '#EF5350';
            }
            const failEl = document.getElementById('kpiFailCount');
            if (failEl) {
                const val = parseInt(failEl.textContent);
                failEl.style.color = (val === 0 || isNaN(val)) ? '#4CAF50' : '#EF5350';
            }
        }

        function startDashboardAutoRefresh() {
            if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
            dashboardRefreshTimer = setInterval(async () => {
                const pg = document.getElementById('dashboard');
                if (pg && pg.classList.contains('active')) {
                    await loadDashboardKPI();
                    await Promise.all([
                        loadBlendingCompletionChart(dashboardPeriods.completion),
                        loadMixingInspectionChart(dashboardPeriods.inspection),
                        loadBlendingByPowderChart(dashboardPeriods.byPowder),
                        loadNgInspections()
                    ]);
                    updateKpiColors();
                    const now = new Date();
                    const el = document.getElementById('dashboardLastUpdate');
                    if (el) el.textContent = now.toTimeString().slice(0, 8);
                }
            }, 60000);
        }

        // NG 현황 로드
        async function loadNgInspections() {
            const container = document.getElementById('chartNgStatus');
            if (!container) return;
            try {
                const resp = await fetch(`${API_BASE}/api/dashboard/ng-inspections`);
                const data = await resp.json();
                if (!data.success) throw new Error(data.message);

                const ngList   = data.ng_list   || [];
                const passList = data.recent_pass || [];
                const allRows  = [...ngList, ...passList];

                const badge = document.getElementById('ngSummaryBadge');
                if (badge) {
                    const pending = ngList.filter(r => r.status === 'NG확정').length;
                    const inprog  = ngList.filter(r => r.status === '재검사진행중').length;
                    badge.textContent =
                        `미처리 ${pending}건${inprog ? ' / 재검사중 ' + inprog + '건' : ''}${passList.length ? ' / 재검사합격 ' + passList.length + '건' : ''}`;
                }

                if (allRows.length === 0) {
                    container.innerHTML = '<div style="color:#4CAF50; text-align:center; padding:40px 0; font-size:0.95em;">✓ NG 항목 없음</div>';
                    return;
                }

                const statusStyle = {
                    'NG확정':     'background:#C62828; color:#fff;',
                    '재검사진행중': 'background:#F07D00; color:#fff;',
                    '재검사합격':  'background:#2E7D32; color:#fff;'
                };

                let html = `<table style="width:100%; border-collapse:collapse; font-size:0.85em;">
                    <thead><tr style="background:#2A2A2A; color:#A0A0A0;">
                        <th style="padding:8px 10px; text-align:left;">분말</th>
                        <th style="padding:8px 10px; text-align:left;">LOT</th>
                        <th style="padding:8px 10px; text-align:center;">검사일</th>
                        <th style="padding:8px 10px; text-align:center;">경과</th>
                        <th style="padding:8px 10px; text-align:left;">NG 항목</th>
                        <th style="padding:8px 10px; text-align:center;">상태</th>
                    </tr></thead><tbody>`;

                allRows.forEach(row => {
                    const days    = row.days_elapsed != null ? `${row.days_elapsed}일` : '-';
                    const dayColor = row.days_elapsed > 7 ? '#EF5350' : row.days_elapsed > 3 ? '#FFA726' : '#A0A0A0';
                    const items   = (row.failed_items || []).join(', ') || '-';
                    const st      = row.status;
                    const stStyle = statusStyle[st] || '';
                    const round   = row.current_round > 1 ? ` (${row.current_round}차)` : '';
                    html += `<tr style="border-bottom:1px solid #2A2A2A;">
                        <td style="padding:8px 10px; font-weight:600;">${row.powder_name}</td>
                        <td style="padding:8px 10px; color:#A0A0A0;">${row.lot_number}</td>
                        <td style="padding:8px 10px; text-align:center; color:#A0A0A0;">${row.inspection_date || '-'}</td>
                        <td style="padding:8px 10px; text-align:center; color:${dayColor}; font-weight:600;">${days}</td>
                        <td style="padding:8px 10px; color:#EF9A9A;">${items}</td>
                        <td style="padding:8px 10px; text-align:center;">
                            <span style="padding:2px 8px; border-radius:4px; font-size:0.8em; font-weight:600; ${stStyle}">${st}${round}</span>
                        </td>
                    </tr>`;
                });

                html += '</tbody></table>';
                container.innerHTML = html;
            } catch (e) {
                container.innerHTML = `<div style="color:#EF9A9A; text-align:center; padding:20px;">${e.message}</div>`;
            }
        }

        // 재검사 요청 모달
        let retestTarget = { powderName: '', lotNumber: '' };

        function openRetestModal(powderName, lotNumber) {
            retestTarget = { powderName, lotNumber };
            const label = document.getElementById('retestTargetLabel');
            if (label) label.textContent = `${powderName} / LOT: ${lotNumber}`;
            const ta = document.getElementById('retestReason');
            if (ta) ta.value = '';
            const modal = document.getElementById('retestModal');
            if (modal) modal.style.display = 'flex';
        }

        function closeRetestModal() {
            const modal = document.getElementById('retestModal');
            if (modal) modal.style.display = 'none';
        }

        async function submitRetestRequest() {
            const reason = (document.getElementById('retestReason')?.value || '').trim();
            if (!reason) { alert('재검사 사유를 입력하세요.'); return; }

            try {
                const resp = await fetch(`${API_BASE}/api/retest/request`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        powderName: retestTarget.powderName,
                        lotNumber:  retestTarget.lotNumber,
                        reason
                    })
                });
                const data = await resp.json();
                if (!data.success) { alert('요청 실패: ' + data.message); return; }

                closeRetestModal();
                alert(`✓ 재검사 요청 완료 (${data.nextRound}차 검사)\n\n수입검사 화면에서 동일 분말/LOT를 입력하여 재검사를 시작하세요.`);
                await loadNgInspections();
            } catch (e) {
                alert('오류: ' + e.message);
            }
        }

        // KPI 카드 로드
        async function loadDashboardKPI() {
            try {
                const response = await fetch(`${API_BASE}/api/dashboard/kpi`);
                const data = await response.json();
                if (data.success) {
                    document.getElementById('kpiTodayBlending').textContent = data.data.today_blending;
                    document.getElementById('kpiWeekBlending').textContent  = data.data.week_blending;
                    document.getElementById('kpiPassRate').textContent       = data.data.pass_rate;
                    document.getElementById('kpiFailCount').textContent      = data.data.fail_count;
                }
            } catch (e) { console.error('KPI 로드 실패:', e); }
        }

        // ── 공통 헬퍼 ──
        function setTabActive(tabGroupId, activeBtn) {
            document.querySelectorAll(`#${tabGroupId} .chart-tab`).forEach(b => b.classList.remove('active'));
            if (activeBtn) activeBtn.classList.add('active');
        }
        function emptyChart(elId, msg) {
            document.getElementById(elId).innerHTML =
                `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">${msg}</div>`;
        }
        function chartHeight(elId) {
            const el = document.getElementById(elId);
            return el ? (el.clientHeight || 280) : 280;
        }

        // ── 좌상: 배합작업 완료현황 ──
        function switchBlendingCompletionPeriod(period, btn) {
            dashboardPeriods.completion = period;
            setTabActive('blendingCompletionTabs', btn);
            loadBlendingCompletionChart(period);
        }

        async function loadBlendingCompletionChart(period = 'daily') {
            try {
                const res  = await fetch(`${API_BASE}/api/dashboard/blending-completion?period=${period}`);
                const data = await res.json();
                if (!data.success || !data.data.length) {
                    emptyChart('chartBlendingCompletion', '데이터가 없습니다'); return;
                }
                const opts = {
                    series: [{ name: '완료 건수', data: data.data.map(d => d.count) }],
                    chart: { type: 'bar', height: chartHeight('chartBlendingCompletion'),
                             toolbar: { show: false }, foreColor: '#A0A0A0' },
                    colors: ['#F07D00'],
                    plotOptions: { bar: { borderRadius: 5, columnWidth: '55%',
                        dataLabels: { position: 'top' } } },
                    dataLabels: { enabled: true, offsetY: -18,
                        style: { fontSize: '12px', colors: ['#E0E0E0'] } },
                    xaxis: { categories: data.data.map(d => d.label),
                             tickAmount: data.data.length,
                             labels: { rotate: -45, rotateAlways: true,
                                       hideOverlappingLabels: false,
                                       style: { fontSize: '11px', colors: '#A0A0A0' } } },
                    yaxis: { title: { text: '완료 건수' }, min: 0,
                             labels: { formatter: v => Math.round(v) } },
                    tooltip: { theme: 'dark' },
                    grid: { borderColor: '#333' }
                };
                if (charts.blendingCompletion) charts.blendingCompletion.destroy();
                charts.blendingCompletion = new ApexCharts(document.getElementById('chartBlendingCompletion'), opts);
                charts.blendingCompletion.render();
            } catch (e) { console.error('배합완료현황 차트 실패:', e); }
        }

        // ── 우상: 배합분말 검사현황 (stacked bar) ──
        function switchMixingInspectionPeriod(period, btn) {
            dashboardPeriods.inspection = period;
            setTabActive('mixingInspectionTabs', btn);
            loadMixingInspectionChart(period);
        }

        async function loadMixingInspectionChart(period = 'daily') {
            try {
                const res  = await fetch(`${API_BASE}/api/dashboard/mixing-inspection?period=${period}`);
                const data = await res.json();
                if (!data.success || !data.data.length) {
                    emptyChart('chartMixingInspection', '데이터가 없습니다'); return;
                }
                const opts = {
                    series: [
                        { name: '완료', data: data.data.map(d => d.completed) },
                        { name: '진행중', data: data.data.map(d => d.in_progress) }
                    ],
                    chart: { type: 'bar', height: chartHeight('chartMixingInspection'),
                             stacked: true, toolbar: { show: false }, foreColor: '#A0A0A0' },
                    colors: ['#4CAF50', '#F07D00'],
                    plotOptions: { bar: { borderRadius: 4, columnWidth: '55%' } },
                    dataLabels: { enabled: true,
                        formatter: (val) => val > 0 ? val : '',
                        style: { fontSize: '11px', colors: ['#fff'] } },
                    xaxis: { categories: data.data.map(d => d.label),
                             tickAmount: data.data.length,
                             labels: { rotate: -45, rotateAlways: true,
                                       hideOverlappingLabels: false,
                                       style: { fontSize: '11px', colors: '#A0A0A0' } } },
                    yaxis: { title: { text: '건수' }, min: 0,
                             labels: { formatter: v => Math.round(v) } },
                    tooltip: { theme: 'dark',
                        y: { formatter: (val, { seriesIndex, dataPointIndex, w }) => {
                            const t = w.config.series.reduce((s, sr) => s + sr.data[dataPointIndex], 0);
                            return `${val}건 (대상 ${data.data[dataPointIndex].target}건)`;
                        }}
                    },
                    legend: { position: 'top', horizontalAlign: 'right' },
                    grid: { borderColor: '#333' }
                };
                if (charts.mixingInspection) charts.mixingInspection.destroy();
                charts.mixingInspection = new ApexCharts(document.getElementById('chartMixingInspection'), opts);
                charts.mixingInspection.render();
            } catch (e) { console.error('배합검사현황 차트 실패:', e); }
        }

        // ── 좌하: 배합분말별 작업현황 ──
        function switchBlendingByPowderPeriod(period, btn) {
            dashboardPeriods.byPowder = period;
            setTabActive('blendingByPowderTabs', btn);
            loadBlendingByPowderChart(period);
        }

        async function loadBlendingByPowderChart(period = 'today') {
            try {
                const res  = await fetch(`${API_BASE}/api/dashboard/blending-by-powder?period=${period}`);
                const data = await res.json();
                if (!data.success || !data.data.length) {
                    emptyChart('chartBlendingByPowder', '데이터가 없습니다'); return;
                }
                const opts = {
                    series: [{ name: '작업 건수', data: data.data.map(d => d.count) }],
                    chart: { type: 'bar', height: chartHeight('chartBlendingByPowder'),
                             toolbar: { show: false }, foreColor: '#A0A0A0' },
                    colors: ['#AB47BC'],
                    plotOptions: { bar: { horizontal: true, borderRadius: 5, barHeight: '60%',
                        dataLabels: { position: 'top' } } },
                    dataLabels: { enabled: true, offsetX: 20,
                        style: { fontSize: '12px', colors: ['#E0E0E0'] } },
                    xaxis: { categories: data.data.map(d => d.powder),
                             labels: { formatter: v => Math.round(v) } },
                    tooltip: { theme: 'dark' },
                    grid: { borderColor: '#333' }
                };
                if (charts.blendingByPowder) charts.blendingByPowder.destroy();
                charts.blendingByPowder = new ApexCharts(document.getElementById('chartBlendingByPowder'), opts);
                charts.blendingByPowder.render();
            } catch (e) { console.error('분말별작업현황 차트 실패:', e); }
        }

        // (하위 호환) 구 함수명 참조가 남아있을 경우 대비
        async function loadWorkProgressChart() {}
        async function loadQualityRateChart() {}
        async function loadDailyTrendChart() {}
        async function loadPowderStatusChart() {}


        // ==========================================
        // 자동입력 작업 화면 관련 함수
        // ==========================================

        // work_id로 자동입력 페이지 로드 (DB 연동)
        let currentAutoInputWorkId = null;
        let currentAutoInputWork = null;
        let currentAutoInputRecipes = [];

        async function loadAutoInputPage(workId, sourcePage = 'blending') {
            try {
                // 캐시 초기화
                approvedLotsCache = {};
                lotRowCounters = {};

                // DB에서 배합작업 정보 가져오기
                const response = await fetch(`${API_BASE}/api/blending/work/${workId}`);
                const data = await response.json();

                if (!data.success) {
                    alert('배합 작업 로딩 실패: ' + data.message);
                    return;
                }

                currentAutoInputWorkId = workId;
                currentAutoInputWork = data.work;
                currentAutoInputRecipes = data.recipes;

                // 자동입력 페이지로 이동
                showPage('auto-input');

                // 작업 정보 표시
                document.getElementById('autoInputProductName').textContent = data.work.product_name;
                document.getElementById('autoInputBatchLot').textContent = data.work.batch_lot;
                document.getElementById('autoInputTargetWeight').textContent = parseFloat(data.work.target_total_weight).toLocaleString();

                // 원재료 목록 렌더링
                await renderAutoInputMaterialListFromDB(data.work, data.recipes, data.material_inputs || []);
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // 자동입력 모드 시작 (구버전 - 사용 안 함)
        async function startAutoInputMode() {
            // 배합작업 폼 검증
            const productName = document.getElementById('blendingProductName').value;
            const batchLot = document.getElementById('blendingBatchLot').value;
            const targetWeight = document.getElementById('blendingTargetWeight').value;
            const operator = document.getElementById('blendingOperator').value;

            if (!productName || !batchLot || !targetWeight || !operator) {
                alert('배합작업 정보를 먼저 입력해주세요.\n(제품명, 배합 LOT, 배합중량, 작업자)');
                return;
            }

            // Recipe 확인
            if (!currentRecipe || currentRecipe.length === 0) {
                alert('제품의 Recipe 정보가 없습니다.');
                return;
            }

            // 자동입력 페이지로 이동
            showPage('auto-input');

            // 작업 정보 표시
            document.getElementById('autoInputProductName').textContent = productName;
            document.getElementById('autoInputBatchLot').textContent = batchLot;
            document.getElementById('autoInputTargetWeight').textContent = parseFloat(targetWeight).toLocaleString();

            // 원재료 목록 렌더링
            await renderAutoInputMaterialList();
        }

        // DB에서 가져온 데이터로 자동입력 원재료 목록 렌더링
        async function renderAutoInputMaterialListFromDB(work, recipes, materialInputs) {
            const listContainer = document.getElementById('autoInputMaterialList');
            const targetWeight = parseFloat(work.target_total_weight);

            if (!recipes || recipes.length === 0) {
                listContainer.innerHTML = '<div class="empty-message">Recipe 정보가 없습니다.</div>';
                return;
            }

            // Main 분말 중량 정보 가져오기
            const mainWeights = {};
            recipes.forEach(item => {
                if (item.is_main == 1 || item.is_main === true) {
                    // work.main_powder_weights가 있으면 사용, 없으면 targetWeight를 Main 중량으로 사용
                    if (work.main_powder_weights && work.main_powder_weights[item.powder_name]) {
                        mainWeights[item.powder_name] = parseFloat(work.main_powder_weights[item.powder_name]);
                    } else {
                        mainWeights[item.powder_name] = targetWeight;
                    }
                }
            });

            // Main 분말들의 비율 합계 계산
            const mainRecipes = recipes.filter(r => r.is_main == 1 || r.is_main === true);
            const totalMainRatio = mainRecipes.reduce((sum, r) => sum + r.ratio, 0);

            // 전체 배합 총중량 계산: Main 중량 / (Main 비율 / 100)
            // 예: Main 2000kg, 비율 97.2% → 전체 = 2000 / 0.972 = 2057.61kg
            const mainTotalWeight = Object.values(mainWeights).reduce((sum, w) => sum + w, 0);
            const actualTotalWeight = totalMainRatio > 0 ? mainTotalWeight / (totalMainRatio / 100) : targetWeight;

            // 각 분말의 필요 중량 계산
            const materials = recipes.map((item, index) => {
                let calculatedWeight = 0;

                if (item.is_main == 1 || item.is_main === true) {
                    // Main 분말: 저장된 중량 또는 targetWeight 사용
                    calculatedWeight = mainWeights[item.powder_name] || targetWeight;
                } else {
                    // 첨가분말: 전체 총중량 × 비율로 계산
                    calculatedWeight = actualTotalWeight * item.ratio / 100;
                }

                // 허용 오차 범위 계산 (g 절대값 기준)
                const toleranceMinus = item.tolerance_minus !== undefined && item.tolerance_minus !== null ? item.tolerance_minus : 5;
                const tolerancePlus = item.tolerance_plus !== undefined && item.tolerance_plus !== null ? item.tolerance_plus : 5;
                const minWeight = calculatedWeight - toleranceMinus / 1000;  // g → kg
                const maxWeight = calculatedWeight + tolerancePlus / 1000;   // g → kg

                return {
                    index: index,
                    powderName: item.powder_name,
                    ratio: item.ratio,
                    calculatedWeight: calculatedWeight.toFixed(3),
                    minWeight: minWeight,
                    maxWeight: maxWeight,
                    toleranceMinus: toleranceMinus,
                    tolerancePlus: tolerancePlus,
                    category: item.powder_category,
                    isMain: item.is_main == 1 || item.is_main === true
                };
            });

            // 진행 상황 업데이트
            document.getElementById('autoInputProgress').textContent = `0/${materials.length}`;

            // HTML 생성 - 단계 도트 + 각 분말 카드 (순서대로 하나씩만 표시)
            let dotsHtml = `<div id="stepDotsContainer" style="display:flex; gap:10px; align-items:center; margin-bottom:20px; padding:12px 16px; background:#1A1A2E; border-radius:8px; border:1px solid #333; flex-wrap:wrap;">`;
            materials.forEach((m, i) => {
                dotsHtml += `<span id="stepDot_${i}" title="${m.powderName}" style="width:14px; height:14px; border-radius:50%; background:#444; display:inline-block; transition:background 0.3s;"></span>`;
            });
            dotsHtml += `<span style="margin-left:8px; color:#A0A0A0; font-size:0.9em;" id="stepLabel">준비중...</span>`;
            dotsHtml += `</div>`;

            let html = dotsHtml;
            materials.forEach((material, idx) => {
                const statusBadge = '<span class="status-badge waiting">대기</span>';

                html += `
                    <div class="material-input-row" id="materialRow_${idx}" data-index="${idx}"
                         style="display:none;"
                         data-min-weight="${material.minWeight}"
                         data-max-weight="${material.maxWeight}"
                         data-calculated-weight="${material.calculatedWeight}"
                         data-tolerance-minus="${material.toleranceMinus}"
                         data-tolerance-plus="${material.tolerancePlus}"
                         data-is-main="${material.isMain}"
                         data-powder-name="${material.powderName}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <div>
                                <h4 style="margin: 0 0 5px 0; display: flex; align-items: center; gap: 10px;">
                                    <span style="font-size: 1.3em; font-weight: 700; color: #E8E8E8;">${material.powderName}</span>
                                    ${material.isMain ? '<span style="background: #F07D00; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 600;">MAIN</span>' : ''}
                                    ${statusBadge}
                                </h4>
                                <p style="margin: 0; color: #A0A0A0; font-size: 0.9em;">
                                    비율: ${material.ratio}% |
                                    목표 중량: ${material.isMain ? parseFloat(material.calculatedWeight).toLocaleString() + ' kg' : Math.round(parseFloat(material.calculatedWeight) * 1000).toLocaleString() + ' g'} |
                                    허용범위: -${material.toleranceMinus}g ~ +${material.tolerancePlus}g
                                </p>
                            </div>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <button type="button" class="btn secondary" onclick="addLotRow(${idx})"
                                        id="addLotBtn_${idx}" disabled
                                        style="padding: 8px 16px; font-size: 0.9em;">
                                    ➕ LOT 추가
                                </button>
                            </div>
                        </div>

                        <!-- LOT 입력 테이블 -->
                        <div style="background: #1E1E1E; border-radius: 8px; padding: 15px;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background: #333;">
                                        <th style="padding: 10px; text-align: left; width: 40%;">📱 LOT 번호</th>
                                        <th style="padding: 10px; text-align: center; width: 40%;">⚖️ 계량 중량 (${material.isMain ? 'kg' : 'g'})</th>
                                        <th style="padding: 10px; text-align: center; width: 20%;">작업</th>
                                    </tr>
                                </thead>
                                <tbody id="lotTableBody_${idx}">
                                    <!-- LOT 행들이 여기에 추가됨 -->
                                </tbody>
                            </table>

                            <!-- 합계 및 판정 영역 -->
                            <div style="margin-top: 15px; padding: 15px; background: white; border-radius: 8px; border: 2px solid #F07D00; color: #000;">
                                <div style="display: grid; grid-template-columns: 1fr 1fr auto 1fr 1fr; gap: 15px; align-items: center;">
                                    <div style="text-align: center;">
                                        <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">합계 중량</div>
                                        <div style="font-size: 1.2em; font-weight: 700; color: #333;">
                                            <span id="totalWeight_${idx}">0</span> ${material.isMain ? 'kg' : 'g'}
                                        </div>
                                    </div>

                                    <div style="text-align: center; border-left: 1px solid #eee; padding-left: 15px;">
                                        <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">잔여 중량</div>
                                        <div style="font-size: 1.2em; font-weight: 700;">
                                            <span id="remainingWeight_${idx}" style="color: #999;">-</span>
                                        </div>
                                    </div>

                                    <!-- 허용 중량 범위 -->
                                    <div style="padding: 10px 15px; background: #1A1A2E; border: 2px solid #F07D00; border-radius: 8px; text-align: center; min-width: 180px;">
                                        <div style="font-size: 0.75em; color: #A0A0A0; margin-bottom: 5px;">허용 중량 범위</div>
                                        <div style="font-weight: 700; color: #F07D00; font-size: 1.1em; line-height: 1.3;">
                                            ${material.isMain ? parseFloat(material.minWeight).toFixed(2) + ' ~ ' + parseFloat(material.maxWeight).toFixed(2) + ' kg' : Math.floor(parseFloat(material.minWeight) * 1000).toLocaleString() + ' ~ ' + Math.ceil(parseFloat(material.maxWeight) * 1000).toLocaleString() + ' g'}
                                        </div>
                                    </div>

                                    <!-- 판정 버튼 -->
                                    <div style="display: flex; gap: 10px; align-items: center;">
                                        <button type="button"
                                                class="btn"
                                                onclick="judgeMaterialWeight(${idx})"
                                                id="judgeBtn_${idx}"
                                                disabled
                                                style="padding: 10px 16px; font-size: 0.95em; background: #F07D00; color: white; border: none; min-width: 80px; opacity: 0.5;">
                                            🔍 판정
                                        </button>
                                        <div id="judgeResult_${idx}" style="font-weight: 700; font-size: 1em; min-width: 70px; text-align: center; color: #333;">
                                        </div>
                                    </div>

                                    <!-- 완료 버튼 -->
                                    <div>
                                        <button type="button" class="btn" onclick="completeAutoInputMaterial(${idx})"
                                                id="completeMaterialBtn_${idx}" disabled style="opacity: 0.5; width: 100%;">
                                            ✓ 이 분말 투입 완료
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            listContainer.innerHTML = html;

            // materialInputs 처리: 이미 투입 완료된 분말 복원
            const completedMaterials = new Map();
            if (materialInputs && materialInputs.length > 0) {
                materialInputs.forEach(input => {
                    completedMaterials.set(input.powder_name, {
                        lots: input.material_lot.split(',').map(lot => lot.trim()),
                        weight: input.actual_weight
                    });
                });
            }

            let firstIncompleteIndex = -1;
            let completedCount = 0;

            // 각 분말에 대해 완료 상태 복원
            materials.forEach((material, idx) => {
                const materialRow = document.getElementById(`materialRow_${idx}`);
                const completedData = completedMaterials.get(material.powderName);

                if (completedData) {
                    // 완료된 분말: 데이터 복원 및 비활성화
                    completedCount++;

                    // 상태 변경
                    materialRow.classList.remove('active');
                    const statusBadge = materialRow.querySelector('.status-badge');
                    statusBadge.className = 'status-badge completed';
                    statusBadge.textContent = '완료';

                    // LOT 정보 표시 (읽기 전용)
                    const tableBody = document.getElementById(`lotTableBody_${idx}`);
                    const isMain = material.isMain;

                    completedData.lots.forEach((lotNumber, lotIdx) => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td style="padding: 10px;">
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <input type="text" value="${lotNumber}" readonly
                                           style="flex: 1; padding: 8px; background: #2C2C2C; border: 1px solid #444; border-radius: 4px;">
                                    <div style="min-width: 60px; font-weight: 600; font-size: 0.9em; color: #4CAF50;">✓ 합격</div>
                                </div>
                            </td>
                            <td style="padding: 10px;">
                                <input type="text" value="${isMain && completedData.lots.length === 1 ? (completedData.weight).toLocaleString() : ''}" readonly
                                       style="width: 100%; padding: 8px; background: #2C2C2C; border: 1px solid #444; border-radius: 4px; text-align: center;">
                            </td>
                            <td style="padding: 10px; text-align: center;">
                                <span style="color: #666;">-</span>
                            </td>
                        `;
                        tableBody.appendChild(row);
                    });

                    // 합계 중량 표시 (Main은 kg, 첨가분말은 g)
                    const displayWeight = material.isMain ? completedData.weight.toFixed(2) : Math.round(completedData.weight * 1000).toLocaleString();
                    document.getElementById(`totalWeight_${idx}`).textContent = displayWeight;

                    // 판정 결과 표시
                    const judgeResult = document.getElementById(`judgeResult_${idx}`);
                    judgeResult.innerHTML = '<span style="color: #4CAF50; font-size: 1.1em;">⭕ 합격</span>';
                    judgeResult.dataset.result = 'pass';

                    // 버튼 비활성화
                    document.getElementById(`addLotBtn_${idx}`).disabled = true;
                    document.getElementById(`judgeBtn_${idx}`).disabled = true;
                    document.getElementById(`completeMaterialBtn_${idx}`).disabled = true;

                } else {
                    // 미완료 분말: 첫 번째 미완료 분말 기록
                    if (firstIncompleteIndex === -1) {
                        firstIncompleteIndex = idx;
                    }
                }
            });

            // 진행 상황 업데이트
            document.getElementById('autoInputProgress').textContent = `${completedCount}/${materials.length}`;

            // 첫 번째 미완료 분말 활성화
            if (firstIncompleteIndex !== -1) {
                setTimeout(() => {
                    activateMaterialRow(firstIncompleteIndex);
                }, 100);
            }
        }

        // 자동입력 원재료 목록 렌더링 (구버전 - 사용 안 함)
        async function renderAutoInputMaterialList() {
            const listContainer = document.getElementById('autoInputMaterialList');
            const targetWeight = parseFloat(document.getElementById('blendingTargetWeight').value);

            if (!currentRecipe || currentRecipe.length === 0) {
                listContainer.innerHTML = '<div class="empty-message">Recipe 정보가 없습니다.</div>';
                return;
            }

            // Main 분말 중량 정보 가져오기
            const mainWeights = {};
            currentRecipe.forEach(item => {
                if (item.powder_category === 'main') {
                    const weightInput = document.getElementById(`mainWeight_${item.powder_name}`);
                    if (weightInput) {
                        mainWeights[item.powder_name] = parseFloat(weightInput.value) || 0;
                    }
                }
            });

            // 각 분말의 필요 중량 계산
            const materials = currentRecipe.map((item, index) => {
                let calculatedWeight = 0;

                if (item.powder_category === 'main') {
                    // Main은 직접 입력한 중량 사용
                    calculatedWeight = mainWeights[item.powder_name] || (targetWeight * item.ratio / 100);
                } else {
                    // Main 외 분말은 비율로 계산
                    calculatedWeight = targetWeight * item.ratio / 100;
                }

                // 허용 오차 범위 계산 (g 절대값 기준)
                const toleranceMinus = item.tolerance_minus !== undefined && item.tolerance_minus !== null ? item.tolerance_minus : 5;
                const tolerancePlus = item.tolerance_plus !== undefined && item.tolerance_plus !== null ? item.tolerance_plus : 5;
                const minWeight = calculatedWeight - toleranceMinus / 1000;  // g → kg
                const maxWeight = calculatedWeight + tolerancePlus / 1000;   // g → kg

                return {
                    index: index,
                    powderName: item.powder_name,
                    ratio: item.ratio,
                    calculatedWeight: calculatedWeight.toFixed(3),
                    minWeight: minWeight,
                    maxWeight: maxWeight,
                    toleranceMinus: toleranceMinus,
                    tolerancePlus: tolerancePlus,
                    category: item.powder_category,
                    isMain: item.powder_category === 'main'
                };
            });

            // 진행 상황 업데이트
            document.getElementById('autoInputProgress').textContent = `0/${materials.length}`;

            // HTML 생성
            let html = '';
            materials.forEach((material, idx) => {
                const rowClass = idx === 0 ? 'material-input-row active' : 'material-input-row';
                const statusBadge = idx === 0 ? '<span class="status-badge active">진행중</span>' : '<span class="status-badge waiting">대기</span>';

                html += `
                    <div class="${rowClass}" id="materialRow_${idx}" data-index="${idx}"
                         data-min-weight="${material.minWeight}"
                         data-max-weight="${material.maxWeight}"
                         data-calculated-weight="${material.calculatedWeight}"
                         data-tolerance-minus="${material.toleranceMinus}"
                         data-tolerance-plus="${material.tolerancePlus}"
                         data-is-main="${material.isMain}"
                         data-powder-name="${material.powderName}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                            <div>
                                <h4 style="margin: 0 0 5px 0; display: flex; align-items: center; gap: 10px;">
                                    <span style="font-size: 1.3em; font-weight: 700; color: #E8E8E8;">${material.powderName}</span>
                                    ${material.isMain ? '<span style="background: #F07D00; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 600;">MAIN</span>' : ''}
                                    ${statusBadge}
                                </h4>
                                <p style="margin: 0; color: #A0A0A0; font-size: 0.9em;">
                                    비율: ${material.ratio}% |
                                    목표 중량: ${material.isMain ? parseFloat(material.calculatedWeight).toLocaleString() + ' kg' : Math.round(parseFloat(material.calculatedWeight) * 1000).toLocaleString() + ' g'} |
                                    허용범위: -${material.toleranceMinus}g ~ +${material.tolerancePlus}g
                                </p>
                            </div>
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <button type="button" class="btn secondary" onclick="addLotRow(${idx})"
                                        id="addLotBtn_${idx}" ${idx !== 0 ? 'disabled' : ''}
                                        style="padding: 8px 16px; font-size: 0.9em;">
                                    ➕ LOT 추가
                                </button>
                                <button type="button" class="btn" onclick="activateMaterialRow(${idx})"
                                        id="activateBtn_${idx}" style="${idx === 0 ? 'display:none;' : ''}">
                                    작업 시작
                                </button>
                            </div>
                        </div>

                        <!-- LOT 입력 테이블 -->
                        <div style="background: #1E1E1E; border-radius: 8px; padding: 15px;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background: #333;">
                                        <th style="padding: 10px; text-align: left; width: 40%;">📱 LOT 번호</th>
                                        <th style="padding: 10px; text-align: center; width: 40%;">⚖️ 계량 중량 (${material.isMain ? 'kg' : 'g'})</th>
                                        <th style="padding: 10px; text-align: center; width: 20%;">작업</th>
                                    </tr>
                                </thead>
                                <tbody id="lotTableBody_${idx}">
                                    <!-- LOT 행들이 여기에 추가됨 -->
                                </tbody>
                            </table>

                            <!-- 합계 및 판정 영역 -->
                            <div style="margin-top: 15px; padding: 15px; background: white; border-radius: 8px; border: 2px solid #F07D00; color: #000;">
                                <div style="display: grid; grid-template-columns: 1fr 1fr auto 1fr 1fr; gap: 15px; align-items: center;">
                                    <div style="text-align: center;">
                                        <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">합계 중량</div>
                                        <div style="font-size: 1.2em; font-weight: 700; color: #333;">
                                            <span id="totalWeight_${idx}">0</span> ${material.isMain ? 'kg' : 'g'}
                                        </div>
                                    </div>

                                    <div style="text-align: center; border-left: 1px solid #eee; padding-left: 15px;">
                                        <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">잔여 중량</div>
                                        <div style="font-size: 1.2em; font-weight: 700;">
                                            <span id="remainingWeight_${idx}" style="color: #999;">-</span>
                                        </div>
                                    </div>

                                    <!-- 허용 중량 범위 -->
                                    <div style="padding: 10px 15px; background: #1A1A2E; border: 2px solid #F07D00; border-radius: 8px; text-align: center; min-width: 180px;">
                                        <div style="font-size: 0.75em; color: #A0A0A0; margin-bottom: 5px;">허용 중량 범위</div>
                                        <div style="font-weight: 700; color: #F07D00; font-size: 1.1em; line-height: 1.3;">
                                            ${material.isMain ? parseFloat(material.minWeight).toFixed(2) + ' ~ ' + parseFloat(material.maxWeight).toFixed(2) + ' kg' : Math.floor(parseFloat(material.minWeight) * 1000).toLocaleString() + ' ~ ' + Math.ceil(parseFloat(material.maxWeight) * 1000).toLocaleString() + ' g'}
                                        </div>
                                    </div>

                                    <!-- 판정 버튼 -->
                                    <div style="display: flex; gap: 10px; align-items: center;">
                                        <button type="button"
                                                class="btn"
                                                onclick="judgeMaterialWeight(${idx})"
                                                id="judgeBtn_${idx}"
                                                disabled
                                                style="padding: 10px 16px; font-size: 0.95em; background: #F07D00; color: white; border: none; min-width: 80px; opacity: 0.5;">
                                            🔍 판정
                                        </button>
                                        <div id="judgeResult_${idx}" style="font-weight: 700; font-size: 1em; min-width: 70px; text-align: center; color: #333;">
                                        </div>
                                    </div>

                                    <!-- 완료 버튼 -->
                                    <div>
                                        <button type="button" class="btn" onclick="completeMaterialInput(${idx})"
                                                id="completeMaterialBtn_${idx}" disabled style="opacity: 0.5; width: 100%;">
                                            ✓ 이 분말 투입 완료
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            listContainer.innerHTML = html;

            // 첫 번째 분말에 LOT 행 하나 추가
            setTimeout(() => {
                addLotRow(0);
            }, 100);
        }

        // 분말별 스캔 LOT 추출 위치 캐시
        let scanLotPositionCache = {};

        async function loadScanLotPosition(powderName) {
            if (scanLotPositionCache[powderName] !== undefined) return;
            try {
                const resp = await fetch(`${API_BASE}/api/admin/powder-spec`);
                const data = await resp.json();
                if (data.success) {
                    data.data.forEach(spec => {
                        scanLotPositionCache[spec.powder_name] = parseInt(spec.scan_lot_position) || 0;
                    });
                }
            } catch (e) { /* 캐시 로드 실패 시 기본값(0) 사용 */ }
        }

        function applyScanLotRule(inputEl, powderName) {
            const pos = scanLotPositionCache[powderName] || 0;
            if (pos <= 0) return; // 0이면 전체 사용
            const raw = inputEl.value.trim();
            if (!raw) return;
            const words = raw.split(/\s+/);
            if (words.length >= pos) {
                inputEl.value = words[pos - 1];
            }
        }

        // LOT 행 추가
        let lotRowCounters = {}; // 각 분말별 LOT 행 카운터
        let approvedLotsCache = {}; // 분말별 합격 LOT 캐시

        function addLotRow(materialIndex) {
            if (!lotRowCounters[materialIndex]) {
                lotRowCounters[materialIndex] = 0;
            }

            const lotIndex = lotRowCounters[materialIndex]++;
            const tableBody = document.getElementById(`lotTableBody_${materialIndex}`);
            const materialRow = document.getElementById(`materialRow_${materialIndex}`);
            const isMain = materialRow.dataset.isMain === 'true';
            const powderName = materialRow.dataset.powderName;

            // Main 분말은 선택 입력, 일반 분말은 숫자 입력
            let weightInputHtml = '';
            if (isMain) {
                weightInputHtml = `
                    <select id="weightInput_${materialIndex}_${lotIndex}"
                            class="auto-input-field weight-input"
                            style="width: 100%; padding: 8px;"
                            onchange="updateTotalWeight(${materialIndex})">
                        <option value="">선택하세요</option>
                        <option value="1000">1 ton (1,000 kg)</option>
                        <option value="2000">2 ton (2,000 kg)</option>
                        <option value="3000">3 ton (3,000 kg)</option>
                        <option value="4000">4 ton (4,000 kg)</option>
                        <option value="5000">5 ton (5,000 kg)</option>
                    </select>
                `;
            } else {
                weightInputHtml = `
                    <input type="number"
                           id="weightInput_${materialIndex}_${lotIndex}"
                           class="auto-input-field weight-input"
                           step="1"
                           style="width: 100%; padding: 8px;"
                           placeholder="중량 입력 (g)"
                           oninput="updateTotalWeight(${materialIndex})">
                `;
            }

            const newRow = document.createElement('tr');
            newRow.id = `lotRow_${materialIndex}_${lotIndex}`;
            newRow.innerHTML = `
                <td style="padding: 10px;">
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text"
                               id="lotInput_${materialIndex}_${lotIndex}"
                               class="auto-input-field lot-input"
                               placeholder="스캔 또는 수동입력"
                               style="flex: 1; padding: 8px;"
                               oninput="resetLotValidation(${materialIndex}, ${lotIndex})"
                               onblur="applyScanLotRule(this, '${powderName}'); validateAutoInputLot(${materialIndex}, ${lotIndex}, '${powderName}')"
                               onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}">
                        <label style="display: flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 0.85em; cursor: pointer;">
                            <input type="checkbox"
                                   id="manualInput_${materialIndex}_${lotIndex}"
                                   style="cursor: pointer;"
                                   title="체크하면 자동 판정이 비활성화되고 수동으로 입력할 수 있습니다">
                            <span style="color: #A0A0A0;">수동</span>
                        </label>
                        <div id="lotValidation_${materialIndex}_${lotIndex}" style="min-width: 60px; font-weight: 600; font-size: 0.9em;"></div>
                    </div>
                </td>
                <td style="padding: 10px;">
                    ${weightInputHtml}
                </td>
                <td style="padding: 10px; text-align: center;">
                    <button type="button"
                            class="btn secondary"
                            onclick="removeLotRow(${materialIndex}, ${lotIndex})"
                            style="padding: 6px 12px; font-size: 0.85em; background: #EF5350; color: white;">
                        🗑️ 삭제
                    </button>
                </td>
            `;

            tableBody.appendChild(newRow);

            // 합격 LOT 목록 및 스캔 규칙 미리 로드
            loadApprovedLotsForMaterial(powderName);
            loadScanLotPosition(powderName);

            // 첫 번째 LOT 입력에 포커스
            setTimeout(() => {
                document.getElementById(`lotInput_${materialIndex}_${lotIndex}`).focus();
            }, 100);

            // 합계 업데이트
            updateTotalWeight(materialIndex);
        }

        // 합격 LOT 목록 로드 (캐싱)
        async function loadApprovedLotsForMaterial(powderName) {
            if (approvedLotsCache[powderName]) {
                return; // 이미 로드됨
            }

            try {
                const response = await fetch(`${API_BASE}/api/completed-lots?powder_name=${encodeURIComponent(powderName)}&category=incoming`);
                const data = await response.json();

                if (data.success && data.lots) {
                    approvedLotsCache[powderName] = data.lots.map(lot => lot.lot_number);
                } else {
                    approvedLotsCache[powderName] = [];
                }
            } catch (error) {
                console.error('합격 LOT 목록 로딩 실패:', error);
                approvedLotsCache[powderName] = [];
            }
        }

        // LOT 검증 상태 초기화 (입력 시)
        function resetLotValidation(materialIndex, lotIndex) {
            const lotInput = document.getElementById(`lotInput_${materialIndex}_${lotIndex}`);
            const validationDiv = document.getElementById(`lotValidation_${materialIndex}_${lotIndex}`);

            if (lotInput) {
                lotInput.style.borderColor = '#ddd';
                lotInput.style.borderWidth = '1px';
                lotInput.dataset.validated = '';
                lotInput.dataset.alertShown = 'false'; // 플래그 초기화
            }

            if (validationDiv) {
                validationDiv.innerHTML = '';
            }

            // 판정 버튼 비활성화
            updateJudgeButtonState(materialIndex);
        }

        // LOT 번호 검증
        async function validateAutoInputLot(materialIndex, lotIndex, powderName) {
            const lotInput = document.getElementById(`lotInput_${materialIndex}_${lotIndex}`);
            const validationDiv = document.getElementById(`lotValidation_${materialIndex}_${lotIndex}`);

            if (!lotInput || !validationDiv) return;

            const lotNumber = lotInput.value.trim();

            // 빈 값이면 검증 안 함
            if (!lotNumber) {
                validationDiv.innerHTML = '';
                lotInput.style.borderColor = '#ddd';
                return;
            }

            // 합격 LOT 목록 로드 (캐시 확인)
            if (!approvedLotsCache[powderName]) {
                validationDiv.innerHTML = '<span style="color: #666;">확인 중...</span>';
                await loadApprovedLotsForMaterial(powderName);
            }

            // 검증
            const approvedLots = approvedLotsCache[powderName] || [];
            const isApproved = approvedLots.includes(lotNumber);

            if (isApproved) {
                // 합격 LOT
                validationDiv.innerHTML = '<span style="color: #4CAF50;">✓ 합격</span>';
                lotInput.style.borderColor = '#4CAF50';
                lotInput.style.borderWidth = '2px';
                lotInput.dataset.validated = 'true';
                lotInput.dataset.alertShown = 'false'; // 플래그 초기화

                // Main 분말이 아닌 경우 중량 입력 칸으로 커서 이동
                const materialRow = document.getElementById(`material_${materialIndex}`);
                const isMain = materialRow && materialRow.dataset.isMain === 'true';
                if (!isMain) {
                    const weightInput = document.getElementById(`weightInput_${materialIndex}_${lotIndex}`);
                    if (weightInput) {
                        setTimeout(() => {
                            weightInput.focus();
                            weightInput.select();
                        }, 100);
                    }
                }
            } else {
                // 불합격 또는 미검사 LOT
                validationDiv.innerHTML = '<span style="color: #EF5350;">✗ 불가</span>';
                lotInput.style.borderColor = '#EF5350';
                lotInput.style.borderWidth = '2px';
                lotInput.dataset.validated = 'false';

                // 경고 메시지 (한 번만 표시)
                if (lotInput.dataset.alertShown !== 'true') {
                    lotInput.dataset.alertShown = 'true';
                    setTimeout(() => {
                        alert(`⚠️ LOT 번호 검증 실패\n\n입력된 LOT: ${lotNumber}\n분말명: ${powderName}\n\n이 LOT는 수입검사 합격 목록에 없습니다.\n합격된 LOT만 사용할 수 있습니다.`);
                    }, 100);
                }
            }

            // 판정 버튼 활성화 상태 업데이트
            updateJudgeButtonState(materialIndex);
        }

        // 판정 버튼 활성화 상태 업데이트
        function updateJudgeButtonState(materialIndex) {
            const tableBody = document.getElementById(`lotTableBody_${materialIndex}`);
            const rows = tableBody.querySelectorAll('tr');
            let allLotsValid = true;
            let hasAnyLot = false;

            rows.forEach(row => {
                const lotInput = row.querySelector('[id^="lotInput_"]');
                if (lotInput && lotInput.value.trim()) {
                    hasAnyLot = true;
                    if (lotInput.dataset.validated !== 'true') {
                        allLotsValid = false;
                    }
                }
            });

            const judgeBtn = document.getElementById(`judgeBtn_${materialIndex}`);
            if (judgeBtn) {
                // 모든 LOT가 검증되고 중량이 입력되어야 판정 가능
                const totalWeight = parseFloat(document.getElementById(`totalWeight_${materialIndex}`).textContent);
                judgeBtn.disabled = !(allLotsValid && hasAnyLot && totalWeight > 0);
                judgeBtn.style.opacity = judgeBtn.disabled ? '0.5' : '1';
            }
        }

        // 합계 중량 업데이트
        function updateTotalWeight(materialIndex) {
            const tableBody = document.getElementById(`lotTableBody_${materialIndex}`);
            const rows = tableBody.querySelectorAll('tr');
            const materialRow = document.getElementById(`materialRow_${materialIndex}`);
            const isMain = materialRow.dataset.isMain === 'true';
            let total = 0;
            let hasAllWeights = rows.length > 0;

            rows.forEach(row => {
                const weightInput = row.querySelector('[id^="weightInput_"]');
                if (weightInput) {
                    const weight = parseFloat(weightInput.value);
                    if (weight && weight > 0) {
                        total += weight;
                    } else {
                        hasAllWeights = false;
                    }
                }
            });

            // 합계 중량 표시 (Main은 kg, 첨가분말은 g - 정수)
            const totalWeightSpan = document.getElementById(`totalWeight_${materialIndex}`);
            if (totalWeightSpan) {
                totalWeightSpan.textContent = isMain ? total.toFixed(2) : Math.round(total).toLocaleString();
            }

            // 잔여 중량 표시
            const remainingSpan = document.getElementById(`remainingWeight_${materialIndex}`);
            if (remainingSpan) {
                const calculatedWeight = parseFloat(materialRow.dataset.calculatedWeight) || 0;
                // Main은 kg 단위, 첨가분말은 g 단위로 변환
                const targetInUnit = isMain ? calculatedWeight : calculatedWeight * 1000;
                const remaining = targetInUnit - total;
                const unit = isMain ? 'kg' : 'g';
                if (total === 0) {
                    remainingSpan.textContent = '-';
                    remainingSpan.style.color = '#999';
                } else if (remaining > 0) {
                    remainingSpan.textContent = `${isMain ? remaining.toFixed(2) : Math.round(remaining).toLocaleString()} ${unit} 남음`;
                    remainingSpan.style.color = '#2E7D32';
                } else if (remaining < 0) {
                    remainingSpan.textContent = `${isMain ? Math.abs(remaining).toFixed(2) : Math.round(Math.abs(remaining)).toLocaleString()} ${unit} 초과`;
                    remainingSpan.style.color = '#C62828';
                } else {
                    remainingSpan.textContent = `0 ${unit} (목표 달성)`;
                    remainingSpan.style.color = '#1565C0';
                }
            }

            // 판정 버튼 활성화 여부 (LOT 검증 포함)
            updateJudgeButtonState(materialIndex);

            // 판정 결과 초기화
            const judgeResult = document.getElementById(`judgeResult_${materialIndex}`);
            if (judgeResult) {
                judgeResult.innerHTML = '';
                judgeResult.dataset.result = '';
            }

            // 완료 버튼 비활성화
            const completeBtn = document.getElementById(`completeMaterialBtn_${materialIndex}`);
            if (completeBtn) {
                completeBtn.disabled = true;
                completeBtn.style.opacity = '0.5';
            }
        }

        // LOT 행 삭제
        function removeLotRow(materialIndex, lotIndex) {
            if (confirm('이 LOT를 삭제하시겠습니까?')) {
                const row = document.getElementById(`lotRow_${materialIndex}_${lotIndex}`);
                if (row) {
                    row.remove();
                }
                updateTotalWeight(materialIndex);
            }
        }

        // 분말 합계 중량 판정
        function judgeMaterialWeight(materialIndex) {
            const materialRow = document.getElementById(`materialRow_${materialIndex}`);
            const judgeResult = document.getElementById(`judgeResult_${materialIndex}`);
            const completeBtn = document.getElementById(`completeMaterialBtn_${materialIndex}`);
            const totalWeightSpan = document.getElementById(`totalWeight_${materialIndex}`);
            const isMain = materialRow.dataset.isMain === 'true';

            // 첨가분말은 g → kg 변환, Main은 그대로
            let totalWeight = parseFloat(totalWeightSpan.textContent.replace(/,/g, ''));
            if (!isMain) {
                totalWeight = totalWeight / 1000; // g → kg
            }

            const minWeight = parseFloat(materialRow.dataset.minWeight);
            const maxWeight = parseFloat(materialRow.dataset.maxWeight);

            // 모든 LOT 번호가 입력되고 검증되었는지 확인
            const tableBody = document.getElementById(`lotTableBody_${materialIndex}`);
            const rows = tableBody.querySelectorAll('tr');
            let allLotsHaveNumbers = true;
            let allLotsValidated = true;

            rows.forEach(row => {
                const lotInput = row.querySelector('[id^="lotInput_"]');
                if (!lotInput || !lotInput.value.trim()) {
                    allLotsHaveNumbers = false;
                } else if (lotInput.dataset.validated !== 'true') {
                    allLotsValidated = false;
                }
            });

            if (!allLotsHaveNumbers) {
                alert('모든 LOT 번호를 입력해주세요.');
                return;
            }

            if (!allLotsValidated) {
                alert('⚠️ 검증 실패\n\n모든 LOT가 수입검사 합격 상태여야 합니다.\n불합격 LOT는 사용할 수 없습니다.');
                return;
            }

            // 합부 판정
            if (totalWeight >= minWeight && totalWeight <= maxWeight) {
                // 합격
                judgeResult.innerHTML = '<span style="color: #4CAF50; font-size: 1.1em;">⭕ 합격</span>';
                judgeResult.dataset.result = 'pass';
                completeBtn.disabled = false;
                completeBtn.style.opacity = '1';

                // 모든 입력 필드 비활성화
                rows.forEach(row => {
                    const lotInput = row.querySelector('[id^="lotInput_"]');
                    const weightInput = row.querySelector('[id^="weightInput_"]');
                    if (lotInput) lotInput.disabled = true;
                    if (weightInput) weightInput.disabled = true;
                });

                // LOT 추가 및 판정 버튼 비활성화
                document.getElementById(`addLotBtn_${materialIndex}`).disabled = true;
                document.getElementById(`judgeBtn_${materialIndex}`).disabled = true;
            } else {
                // 불합격
                judgeResult.innerHTML = '<span style="color: #EF5350; font-size: 1.1em;">❌ 불합격</span>';
                judgeResult.dataset.result = 'fail';
                completeBtn.disabled = true;
                completeBtn.style.opacity = '0.5';

                // 불합격 사유 표시
                let reason = '';
                if (totalWeight < minWeight) {
                    reason = `중량 부족 (${(minWeight - totalWeight).toFixed(2)} kg 부족)`;
                } else {
                    reason = `중량 초과 (+${(totalWeight - maxWeight).toFixed(2)} kg 초과)`;
                }
                alert(`불합격: ${reason}\n허용 범위: ${minWeight.toFixed(2)} ~ ${maxWeight.toFixed(2)} kg\n합계 중량: ${totalWeight.toFixed(2)} kg`);
            }
        }

        // 분말 투입 완료
        // 자동입력 페이지에서 분말 투입 완료 (DB 저장)
        async function completeAutoInputMaterial(materialIndex) {
            if (!currentAutoInputWorkId || !currentAutoInputWork) {
                alert('작업 정보가 없습니다.');
                return;
            }

            const materialRow = document.getElementById(`materialRow_${materialIndex}`);
            const powderName = materialRow.dataset.powderName;
            const isMain = materialRow.dataset.isMain === 'true';
            const minWeight = parseFloat(materialRow.dataset.minWeight);
            const maxWeight = parseFloat(materialRow.dataset.maxWeight);
            const calculatedWeight = parseFloat(materialRow.dataset.calculatedWeight);
            const toleranceMinus = parseFloat(materialRow.dataset.toleranceMinus) || 5;
            const tolerancePlus = parseFloat(materialRow.dataset.tolerancePlus) || 5;

            // LOT 정보 수집 및 검증
            const tableBody = document.getElementById(`lotTableBody_${materialIndex}`);
            const rows = tableBody.querySelectorAll('tr');
            const lots = [];
            let totalWeight = 0;
            let hasInvalidLot = false;

            rows.forEach(row => {
                const lotInput = row.querySelector('[id^="lotInput_"]');
                const weightInput = row.querySelector('[id^="weightInput_"]');
                if (lotInput && weightInput && lotInput.value && weightInput.value) {
                    let weight = parseFloat(weightInput.value);

                    // 첨가분말은 g → kg 변환
                    if (!isMain) {
                        weight = weight / 1000;
                    }

                    // LOT 검증 확인
                    if (lotInput.dataset.validated !== 'true') {
                        hasInvalidLot = true;
                    }

                    lots.push({
                        lotNumber: lotInput.value.trim(),
                        weight: weight,
                        validated: lotInput.dataset.validated === 'true'
                    });
                    totalWeight += weight;
                }
            });

            // 불합격 LOT가 있으면 저장 불가
            if (hasInvalidLot) {
                alert('⚠️ 검증 실패\n\n수입검사 합격되지 않은 LOT가 포함되어 있습니다.\n합격된 LOT만 사용할 수 있습니다.');
                return;
            }

            if (lots.length === 0) {
                alert('최소 1개의 LOT를 입력하세요.');
                return;
            }

            // 중량 판정 확인
            const judgeResult = document.getElementById(`judgeResult_${materialIndex}`);
            if (!judgeResult || judgeResult.dataset.result !== 'pass') {
                alert('중량 판정이 합격이어야 저장할 수 있습니다.\n판정 버튼을 먼저 클릭하세요.');
                return;
            }

            try {
                // LOT별로 별도 레코드 저장 → 추적성에서 개별 투입량 표시 가능
                // (같은 LOT를 2번 입력한 경우 추적성 조회 시 그룹핑으로 합산)
                for (const lot of lots) {
                    const response = await fetch(`${API_BASE}/api/blending/material-input`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            blending_work_id: currentAutoInputWorkId,
                            powder_name: powderName,
                            powder_category: isMain ? 'main' : 'sub',
                            material_lot: lot.lotNumber,
                            target_weight: calculatedWeight,
                            actual_weight: parseFloat(lot.weight.toFixed(3)),
                            tolerance_minus: toleranceMinus,
                            tolerance_plus: tolerancePlus,
                            operator: currentAutoInputWork.operator
                        })
                    });
                    const data = await response.json();
                    if (!data.success) {
                        alert(`저장 실패 (LOT: ${lot.lotNumber}): ${data.message}`);
                        return;
                    }
                }

                alert(`✓ ${powderName} 투입이 기록되었습니다.`);

                // 현재 분말 비활성화 및 완료 표시
                materialRow.classList.remove('active');
                materialRow.querySelector('.status-badge').className = 'status-badge completed';
                materialRow.querySelector('.status-badge').textContent = '완료';

                // 모든 버튼 비활성화
                document.getElementById(`addLotBtn_${materialIndex}`).disabled = true;
                document.getElementById(`completeMaterialBtn_${materialIndex}`).disabled = true;

                // 진행 상황 업데이트
                const totalRows = document.querySelectorAll('.material-input-row').length;
                const completedRows = materialIndex + 1;
                document.getElementById('autoInputProgress').textContent = `${completedRows}/${totalRows}`;

                // 다음 분말이 있으면 활성화
                const nextIndex = materialIndex + 1;
                if (nextIndex < totalRows) {
                    setTimeout(() => {
                        activateMaterialRow(nextIndex);
                    }, 300);
                } else {
                    // 모든 작업 완료 - 배합작업 상태를 완료로 변경
                    await completeBlendingWork();
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        // 배합작업 완료 처리
        async function completeBlendingWork() {
            try {
                const response = await fetch(`${API_BASE}/api/blending/complete/${currentAutoInputWorkId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();
                if (data.success) {
                    alert('✓ 모든 원재료 투입이 완료되었습니다.\n배합작업이 완료되었습니다.\n바코드 라벨을 확인해 주세요.');

                    // 목록 갱신
                    try {
                        loadBlendingOrdersForBlending();
                    } catch (e) { /* noop */ }
                    try {
                        loadInProgressBlendingWorks();
                    } catch (e) { /* noop */ }

                    // 최신 작업 정보 가져오기
                    try {
                        const workResp = await fetch(`${API_BASE}/api/blending/work/${currentAutoInputWorkId}`);
                        const workData = await workResp.json();
                        if (workData.success && workData.work) {
                            currentAutoInputWork = workData.work;
                        }
                    } catch (err) {
                        console.warn('작업정보 재조회 실패:', err);
                    }

                    // 라벨 생성 및 모달로 표시
                    showBarcodeModal(currentAutoInputWork);

                    // 페이지는 유지하여 라벨 확인/인쇄 가능하도록 함
                } else {
                    alert('배합작업 완료 처리 실패: ' + data.message);
                }
            } catch (error) {
                alert('오류: ' + error.message);
            }
        }

        function completeMaterialInput(materialIndex) {
            // 저장 처리 (향후 서버 전송 구현)
            const tableBody = document.getElementById(`lotTableBody_${materialIndex}`);
            const rows = tableBody.querySelectorAll('tr');
            const lots = [];

            rows.forEach(row => {
                const lotInput = row.querySelector('[id^="lotInput_"]');
                const weightInput = row.querySelector('[id^="weightInput_"]');
                if (lotInput && weightInput) {
                    lots.push({
                        lotNumber: lotInput.value,
                        weight: parseFloat(weightInput.value)
                    });
                }
            });

            console.log(`분말 ${materialIndex} 투입 완료:`, lots);

            // 현재 분말 비활성화 및 완료 표시
            const currentRow = document.getElementById(`materialRow_${materialIndex}`);
            currentRow.classList.remove('active');
            currentRow.querySelector('.status-badge').className = 'status-badge completed';
            currentRow.querySelector('.status-badge').textContent = '완료';

            // 모든 버튼 비활성화
            document.getElementById(`addLotBtn_${materialIndex}`).disabled = true;
            document.getElementById(`completeMaterialBtn_${materialIndex}`).disabled = true;

            // 진행 상황 업데이트
            const totalRows = document.querySelectorAll('.material-input-row').length;
            const completedRows = materialIndex + 1;
            document.getElementById('autoInputProgress').textContent = `${completedRows}/${totalRows}`;

            // 다음 분말이 있으면 활성화
            const nextIndex = materialIndex + 1;
            if (nextIndex < totalRows) {
                setTimeout(() => {
                    activateMaterialRow(nextIndex);
                }, 300);
            } else {
                // 모든 작업 완료
                setTimeout(() => {
                    if (confirm('모든 원재료 투입이 완료되었습니다.\n배합작업 페이지로 돌아가시겠습니까?')) {
                        showPage('blending');
                    }
                }, 500);
            }
        }

        // 원재료 행 활성화 (순서대로 하나씩 표시)
        function activateMaterialRow(index) {
            // 모든 행 숨기기
            document.querySelectorAll('.material-input-row').forEach(row => {
                row.style.display = 'none';
                row.classList.remove('active');
            });

            // 해당 행만 표시 및 활성화
            const totalRows = document.querySelectorAll('.material-input-row').length;
            const targetRow = document.getElementById(`materialRow_${index}`);
            if (!targetRow) return;
            targetRow.style.display = 'block';
            targetRow.classList.add('active');
            targetRow.querySelector('.status-badge').className = 'status-badge active';
            targetRow.querySelector('.status-badge').textContent = '진행중';

            // LOT 추가 버튼 활성화
            document.getElementById(`addLotBtn_${index}`).disabled = false;

            // 첫 LOT 행 추가
            const tableBody = document.getElementById(`lotTableBody_${index}`);
            if (tableBody.children.length === 0) {
                addLotRow(index);
            }

            // 단계 도트 업데이트
            document.querySelectorAll('[id^="stepDot_"]').forEach((dot, i) => {
                if (i < index) {
                    dot.style.background = '#4CAF50'; // 완료 (초록)
                } else if (i === index) {
                    dot.style.background = '#F07D00'; // 진행중 (주황)
                } else {
                    dot.style.background = '#444'; // 대기 (회색)
                }
            });
            const stepLabel = document.getElementById('stepLabel');
            if (stepLabel) stepLabel.textContent = `${index + 1} / ${totalRows} 단계`;

            // 진행 상황 업데이트
            document.getElementById('autoInputProgress').textContent = `${index}/${totalRows}`;
        }

        // 초기 로드
        window.onload = () => {
            loadDashboard();
        };

        // ============================================
        // 바코드 스캔 자동 감지 및 처리
        // ============================================
        let barcodeInputTimers = {}; // 각 입력란별 타이머 저장

        document.addEventListener('input', function(event) {
            // LOT 입력란에서만 작동
            if (event.target.tagName === 'INPUT' && event.target.type === 'text') {
                const input = event.target;

                // LOT 입력란 확인
                const isLotInput = input.id && (
                    input.id.includes('lotInput') ||
                    input.classList.contains('lot-input') ||
                    input.placeholder.includes('스캔')
                );

                if (isLotInput && input.value.length > 0) {
                    // 수동 체크박스 확인 (lotInput_X_Y → manualInput_X_Y)
                    const manualCheckboxId = input.id.replace('lotInput', 'manualInput');
                    const manualCheckbox = document.getElementById(manualCheckboxId);

                    // 수동 체크박스가 체크되어 있으면 자동 판정 건너뛰기
                    if (manualCheckbox && manualCheckbox.checked) {
                        return;
                    }

                    // 기존 타이머 취소
                    if (barcodeInputTimers[input.id]) {
                        clearTimeout(barcodeInputTimers[input.id]);
                    }

                    // 200ms 후 자동으로 blur 트리거 (바코드 입력 완료로 판단)
                    barcodeInputTimers[input.id] = setTimeout(() => {
                        if (document.activeElement === input) {
                            // 현재 포커스가 이 입력란에 있으면 blur 트리거
                            input.blur();
                        }
                        delete barcodeInputTimers[input.id];
                    }, 200); // 200ms 대기
                }
            }
        });

        // ============================================
        // 전역 Enter 키 이벤트 리스너 (바코드 스캐너 지원)
        // ============================================
        document.addEventListener('keydown', function(event) {
            // Enter 키를 눌렀을 때
            if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
                const input = event.target;

                // form 내부의 submit 버튼이 있는 경우는 기본 동작 유지
                const form = input.closest('form');
                if (form) {
                    // form의 경우 자동 submit 되도록 기본 동작 유지
                    return;
                }

                // 일반 input의 경우 blur 이벤트 트리거
                event.preventDefault();
                input.blur();

                // blur 후 다음 입력란으로 포커스 이동 (선택사항)
                const allInputs = Array.from(document.querySelectorAll('input:not([disabled]):not([readonly])'));
                const currentIndex = allInputs.indexOf(input);
                if (currentIndex >= 0 && currentIndex < allInputs.length - 1) {
                    // 다음 입력란으로 포커스
                    setTimeout(() => {
                        allInputs[currentIndex + 1].focus();
                    }, 100);
                }
            }
        });

        // ============================================
        // 저울 WebSocket 브릿지 연동 (scale_bridge.exe)
        // ============================================
        (function initScaleBridge() {
            const WS_URL = 'ws://localhost:8765';
            let ws = null;
            let reconnectTimer = null;

            function updateScaleStatusUI(connected) {
                const dot  = document.getElementById('scaleStatus');
                const text = dot ? dot.nextElementSibling : null;
                if (!dot) return;
                if (connected) {
                    dot.style.background = '#4CAF50';
                    if (text) { text.textContent = '저울 연결됨 ✓'; text.style.color = '#4CAF50'; }
                } else {
                    dot.style.background = '#555';
                    if (text) { text.textContent = '연결 안됨 (scale_bridge 실행 필요)'; text.style.color = 'var(--text-secondary)'; }
                }
            }

            function getFocusedWeightInput() {
                const el = document.activeElement;
                if (!el) return null;
                // 부재료 중량 입력칸: id가 weightInput_X_Y 이고 type=number
                if (el.tagName === 'INPUT' && el.type === 'number' &&
                    el.id && el.id.startsWith('weightInput_')) {
                    return el;
                }
                return null;
            }

            function connect() {
                if (ws && ws.readyState <= WebSocket.OPEN) return;

                ws = new WebSocket(WS_URL);

                ws.onopen = () => {
                    clearTimeout(reconnectTimer);
                };

                ws.onmessage = (event) => {
                    let msg;
                    try { msg = JSON.parse(event.data); } catch { return; }

                    if (msg.type === 'status') {
                        updateScaleStatusUI(msg.connected);
                    } else if (msg.type === 'weight') {
                        // 부재료 g 단위 입력칸에만 값 입력
                        const input = getFocusedWeightInput();
                        if (!input) return;

                        const gValue = Math.round(msg.value); // 소수 없음, g 정수
                        input.value = gValue;
                        // oninput 이벤트 수동 발생 (합계 재계산 트리거)
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                };

                ws.onclose = () => {
                    updateScaleStatusUI(false);
                    reconnectTimer = setTimeout(connect, 4000);
                };

                ws.onerror = () => {
                    ws.close();
                };
            }

            // 페이지 로드 후 연결 시작
            connect();
        })();

        // ============================================
        // 바코드 스캔을 위한 자동 영문 모드 전환 (한글 입력 방지)
        // ============================================
        document.addEventListener('focus', function(event) {
            // LOT 번호나 바코드 입력란에 포커스될 때
            if (event.target.tagName === 'INPUT' && event.target.type === 'text') {
                const input = event.target;

                // LOT 입력란이거나 바코드 관련 입력란일 경우
                if (input.id && (
                    input.id.includes('lot') ||
                    input.id.includes('Lot') ||
                    input.id.includes('LOT') ||
                    input.classList.contains('lot-input') ||
                    input.placeholder.includes('LOT') ||
                    input.placeholder.includes('스캔')
                )) {
                    // IME 모드를 비활성화 (영문 모드로 전환)
                    input.style.imeMode = 'disabled';
                    input.style.webkitImeMode = 'disabled';
                    input.setAttribute('lang', 'en');
                }
            }
        }, true);

// ============================================================
// Bot DB 불러오기 기능 (Google Sheets 공개 CSV 방식 — 로그인 불필요)
// ============================================================

// Google Sheets / Drive 설정 — /api/bot-settings 에서 동적으로 로드됨
let BOT_SHEETS_ID    = '';
let BOT_SHEET_NAME   = 'MailLog';
let BOT_DRIVE_API_KEY = '';

// 서버에서 Bot 설정 로드
async function loadBotSettings() {
    try {
        const resp = await fetch(`${API_BASE}/api/bot-settings`);
        const data = await resp.json();
        if (data.success) {
            BOT_SHEETS_ID     = data.data.sheetsId  || '';
            BOT_SHEET_NAME    = data.data.sheetName || 'MailLog';
            BOT_DRIVE_API_KEY = data.data.apiKey    || '';
        }
    } catch (e) { /* 무시 */ }
}

// 관리자 Bot 설정 폼에 현재 값 로드
async function loadBotSettingsForm() {
    await loadBotSettings();
    const si = document.getElementById('botSettingsSheetsId');
    const sn = document.getElementById('botSettingsSheetName');
    const ak = document.getElementById('botSettingsApiKey');
    if (si) si.value = BOT_SHEETS_ID;
    if (sn) sn.value = BOT_SHEET_NAME;
    if (ak) ak.value = BOT_DRIVE_API_KEY;
}

// Bot 설정 저장
async function saveBotSettings() {
    const sheetsId  = document.getElementById('botSettingsSheetsId').value.trim();
    const sheetName = document.getElementById('botSettingsSheetName').value.trim() || 'MailLog';
    const apiKey    = document.getElementById('botSettingsApiKey').value.trim();
    try {
        const resp = await fetch(`${API_BASE}/api/bot-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheetsId, sheetName, apiKey })
        });
        const data = await resp.json();
        if (data.success) {
            BOT_SHEETS_ID     = sheetsId;
            BOT_SHEET_NAME    = sheetName;
            BOT_DRIVE_API_KEY = apiKey;
            const status = document.getElementById('botSettingsSaveStatus');
            status.style.display = 'inline';
            setTimeout(() => { status.style.display = 'none'; }, 3000);
        } else {
            alert('저장 실패: ' + data.message);
        }
    } catch (e) {
        alert('저장 오류: ' + e.message);
    }
}

let botPdfDoc         = null;
let botPdfFile        = null;
let botSelectedPages  = [];
let botCurrentMailRow = null;

// 수입검사 탭 전환
function showIncomingTab(tab) {
    document.querySelectorAll('#incoming .admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#incoming .admin-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`incomingTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
    document.getElementById(`incomingTab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`).classList.add('active');
    if (tab === 'bot') initBotTab();
}

// Bot 탭 진입 시 초기화
async function initBotTab() {
    await loadBotSettings();
    if (!BOT_SHEETS_ID) {
        document.getElementById('botMailList').innerHTML =
            '<div class="empty-message" style="color:#EF9A9A;">Google Sheets ID가 설정되지 않았습니다.<br>관리자 설정에서 Sheets ID를 입력하세요.</div>';
        return;
    }
}

// Google Sheets 공개 CSV로 목록 불러오기 (로그인 불필요)
async function loadBotMailList() {
    await loadBotSettings();
    if (!BOT_SHEETS_ID) {
        document.getElementById('botMailList').innerHTML =
            '<div class="empty-message" style="color:#EF9A9A;">Sheets ID가 설정되지 않았습니다.</div>';
        return;
    }

    document.getElementById('botMailList').innerHTML =
        '<div class="empty-message">불러오는 중...</div>';

    try {
        // 공개 CSV 다운로드 URL (로그인 불필요)
        const csvUrl  = `https://docs.google.com/spreadsheets/d/${BOT_SHEETS_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(BOT_SHEET_NAME)}`;
        const resp    = await fetch(csvUrl);
        if (!resp.ok) throw new Error('Sheets 접근 실패. 공유 설정을 확인하세요.');
        const csvText = await resp.text();

        // CSV 파싱 (헤더 제외)
        const rows = csvText.trim().split('\n').slice(1).map(line => {
            const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
            return cols.map(c => c.replace(/^"|"$/g, '').trim());
        }).filter(r => r.length >= 7);

        // 컬럼: 0=RowIndex, 1=메일ID, 2=업체명, 3=수신일시, 4=제목, 5=파일명, 6=DriveFileId, 7=등록여부
        const allRows = rows.map((r, i) => ({
            sheetRow:    i + 2,
            mailId:      r[1] || '',
            company:     r[2] || '',
            receivedAt:  r[3] || '',
            subject:     r[4] || '',
            fileName:    r[5] || '',
            driveFileId: r[6] || '',
            status:      r[7] || '미등록'
        }));

        // 서버 DB와 대조해서 이미 등록된 것 필터링
        const driveFileIds = allRows.map(r => r.driveFileId).filter(Boolean);
        let registeredIds  = [];
        if (driveFileIds.length > 0) {
            const checkResp = await fetch(`${API_BASE}/api/bot/check-registered`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ driveFileIds })
            });
            const checkData = await checkResp.json();
            if (checkData.success) registeredIds = checkData.registered;
        }

        // 미등록 목록만 표시 (DB 기준 이중 체크)
        const pending = allRows.filter(r => !registeredIds.includes(r.driveFileId));

        renderBotMailList(pending);
        const now = new Date().toLocaleString('ko-KR');
        document.getElementById('botLastSync').textContent = `마지막 동기화: ${now}`;
    } catch (e) {
        document.getElementById('botMailList').innerHTML =
            `<div class="empty-message" style="color:#EF9A9A;">불러오기 실패: ${e.message}</div>`;
    }
}

function renderBotMailList(rows) {
    const container = document.getElementById('botMailList');
    if (rows.length === 0) {
        container.innerHTML = '<div class="empty-message">미등록 메일이 없습니다.</div>';
        return;
    }

    let html = `<table style="width:100%; border-collapse:collapse; font-size:0.93em;">
        <thead><tr style="background:#2A2A2A; color:#A0A0A0;">
            <th style="padding:10px 12px; text-align:left;">업체</th>
            <th style="padding:10px 12px; text-align:left;">수신일시</th>
            <th style="padding:10px 12px; text-align:left;">파일명</th>
            <th style="padding:10px 12px; text-align:center;">상태</th>
            <th style="padding:10px 12px; text-align:center;">액션</th>
        </tr></thead><tbody>`;

    rows.forEach(row => {
        const statusBadge = row.status === '일부등록'
            ? '<span class="badge" style="background:#F07D00;">일부등록</span>'
            : '<span class="badge" style="background:#555;">미등록</span>';
        html += `<tr style="border-bottom:1px solid #2A2A2A;">
            <td style="padding:10px 12px;">${row.company || '-'}</td>
            <td style="padding:10px 12px; color:#A0A0A0; font-size:0.9em;">${row.receivedAt || '-'}</td>
            <td style="padding:10px 12px; color:#A0A0A0; font-size:0.88em; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${row.fileName || ''}">${row.fileName || '-'}</td>
            <td style="padding:10px 12px; text-align:center;">${statusBadge}</td>
            <td style="padding:10px 12px; text-align:center;">
                <button class="btn secondary" style="padding:5px 14px; font-size:0.85em;"
                    onclick="openBotRegisterModal(${JSON.stringify(row).replace(/"/g, '&quot;')})">열기</button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// Bot LOT 등록 모달 열기
async function openBotRegisterModal(row) {
    botCurrentMailRow = row;
    botSelectedPages  = [];
    botPdfDoc         = null;
    botPdfFile        = null;

    document.getElementById('botModalTitle').textContent   = `LOT 등록 — ${row.company}`;
    document.getElementById('botModalSubtitle').textContent = `수신: ${row.receivedAt}  |  파일: ${row.fileName}`;
    document.getElementById('botPdfThumbnails').innerHTML  = '<span style="color:#A0A0A0;font-size:0.85em;">PDF 로딩 중...</span>';
    document.getElementById('botPdfStatus').textContent    = '선택된 페이지 없음';
    document.getElementById('botLotNumber').value          = '';
    document.getElementById('botInspectionDate').value     = row.receivedAt ? row.receivedAt.split(' ')[0].split('/').reverse().join('-') : new Date().toISOString().split('T')[0];

    // 분말명 / 검사자 목록 채우기
    await Promise.all([loadBotPowderList(), loadBotInspectorList()]);

    document.getElementById('botRegisterModal').style.display = 'flex';

    // Google Drive에서 PDF 다운로드
    await loadBotPdf(row.driveFileId, row.fileName);
}

async function loadBotPowderList() {
    try {
        const resp = await fetch(`${API_BASE}/api/powder-list?category=incoming`);
        const data = await resp.json();
        const sel  = document.getElementById('botPowderName');
        sel.innerHTML = '<option value="">선택하세요</option>';
        if (data.success) {
            data.data.forEach(p => {
                const opt = document.createElement('option');
                opt.value = opt.textContent = p;
                sel.appendChild(opt);
            });
        }
    } catch (e) { /* 무시 */ }
}

async function loadBotInspectorList() {
    try {
        const resp = await fetch(`${API_BASE}/api/inspector-list`);
        const data = await resp.json();
        const sel  = document.getElementById('botInspector');
        sel.innerHTML = '<option value="">선택하세요</option>';
        if (data.success) {
            data.data.forEach(ins => {
                const opt = document.createElement('option');
                opt.value = opt.textContent = ins;
                sel.appendChild(opt);
            });
        }
    } catch (e) { /* 무시 */ }
}

// Google Drive API Key로 PDF 다운로드 (CORS 없이 공개 파일 접근)
async function loadBotPdf(driveFileId, fileName) {
    try {
        if (!BOT_DRIVE_API_KEY) throw new Error('Drive API Key가 설정되지 않았습니다. 관리자 설정을 확인하세요.');
        const dlUrl  = `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media&key=${BOT_DRIVE_API_KEY}`;
        const dlResp = await fetch(dlUrl);
        if (!dlResp.ok) throw new Error(`Drive 다운로드 실패 (${dlResp.status}): ${await dlResp.text()}`);
        const blob     = await dlResp.blob();
        botPdfFile     = new File([blob], fileName, { type: 'application/pdf' });
        const arrayBuf = await blob.arrayBuffer();
        botPdfDoc      = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuf) }).promise;
        await renderBotPdfThumbnails();
    } catch (e) {
        document.getElementById('botPdfThumbnails').innerHTML =
            `<span style="color:#EF9A9A;font-size:0.85em;">PDF 로드 실패: ${e.message}</span>`;
    }
}

// Bot 모달용 PDF 썸네일 렌더링 (기존 Millsheet 로직과 동일한 방식)
async function renderBotPdfThumbnails() {
    const container = document.getElementById('botPdfThumbnails');
    container.innerHTML = '';
    const numPages = botPdfDoc.numPages;

    for (let i = 1; i <= numPages; i++) {
        const page = await botPdfDoc.getPage(i);
        const vp   = page.getViewport({ scale: 0.25 });
        const canvas = document.createElement('canvas');
        canvas.width  = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

        const wrapper = document.createElement('div');
        wrapper.id = `botThumb_${i}`;
        wrapper.dataset.page = i;
        wrapper.style.cssText = 'cursor:pointer;border:3px solid #444;border-radius:6px;padding:4px;text-align:center;background:#222;position:relative;';

        const lbl = document.createElement('div');
        lbl.textContent = `${i}페이지`;
        lbl.style.cssText = 'font-size:0.72em;color:#888;margin-top:3px;';

        const badge = document.createElement('div');
        badge.id = `botBadge_${i}`;
        badge.style.cssText = 'display:none;position:absolute;top:4px;right:4px;background:#1976D2;color:#fff;font-size:0.7em;font-weight:700;padding:2px 6px;border-radius:4px;';
        badge.textContent = '✓ 선택';

        wrapper.appendChild(badge);
        wrapper.appendChild(canvas);
        wrapper.appendChild(lbl);
        wrapper.onclick = () => openBotPagePreview(i);
        container.appendChild(wrapper);
    }
    updateBotPdfStatus();
}

// Bot 모달에서 페이지 클릭 시 기존 Millsheet 미리보기 모달 재활용
async function openBotPagePreview(pageNum) {
    // 기존 millsheetPdfDoc을 일시적으로 botPdfDoc으로 교체
    const _origDoc  = millsheetPdfDoc;
    const _origFile = millsheetFile;
    const _origSel  = millsheetSelectedPages;
    millsheetPdfDoc      = botPdfDoc;
    millsheetFile        = botPdfFile;
    millsheetSelectedPages = botSelectedPages;

    await openMillsheetPreview(pageNum);

    // 기존 선택 버튼 동작을 Bot 전용으로 오버라이드
    const origToggle = window.toggleMillsheetPageFromModal;
    window.toggleMillsheetPageFromModal = function() {
        const pn  = millsheetPreviewCurrentPage;
        const idx = botSelectedPages.indexOf(pn);
        const thumb = document.getElementById(`botThumb_${pn}`);
        const badge = document.getElementById(`botBadge_${pn}`);
        if (idx === -1) {
            botSelectedPages.push(pn);
            millsheetSelectedPages = botSelectedPages;
            if (thumb) { thumb.style.borderColor = '#1976D2'; thumb.style.background = 'rgba(25,118,210,0.15)'; }
            if (badge) badge.style.display = 'block';
        } else {
            botSelectedPages.splice(idx, 1);
            millsheetSelectedPages = botSelectedPages;
            if (thumb) { thumb.style.borderColor = '#444'; thumb.style.background = '#222'; }
            if (badge) badge.style.display = 'none';
        }
        updatePreviewSelectButton(pn);
        updateBotPdfStatus();
    };

    // 모달 닫힐 때 원상복구
    const origClose = window.closeMillsheetPreview;
    window.closeMillsheetPreview = function() {
        millsheetPdfDoc      = _origDoc;
        millsheetFile        = _origFile;
        millsheetSelectedPages = _origSel;
        window.toggleMillsheetPageFromModal = origToggle;
        window.closeMillsheetPreview        = origClose;
        document.getElementById('millsheetPreviewModal').style.display = 'none';
    };
}

function updateBotPdfStatus() {
    const el = document.getElementById('botPdfStatus');
    if (!el) return;
    if (botSelectedPages.length === 0) {
        el.textContent = '선택된 페이지 없음';
        el.style.color = '#A0A0A0';
    } else {
        const sorted = [...botSelectedPages].sort((a, b) => a - b);
        el.textContent = `선택된 페이지: ${sorted.join(', ')}페이지`;
        el.style.color = '#4FC3F7';
    }
}

// Bot LOT 등록 실행
async function submitBotLot() {
    const powderName     = document.getElementById('botPowderName').value;
    const lotNumber      = document.getElementById('botLotNumber').value.trim();
    const inspectionDate = document.getElementById('botInspectionDate').value;
    const inspectionType = document.getElementById('botInspectionType').value;
    const inspector      = document.getElementById('botInspector').value;

    if (!powderName)     return alert('분말명을 선택하세요.');
    if (!lotNumber)      return alert('LOT 번호를 입력하세요.');
    if (!inspectionDate) return alert('검사일을 입력하세요.');
    if (!inspector)      return alert('검사자를 선택하세요.');
    if (botSelectedPages.length === 0) return alert('저장할 Millsheet 페이지를 선택하세요.');

    // Millsheet 업로드 (선택된 페이지만)
    const origDoc   = millsheetPdfDoc;
    const origFile  = millsheetFile;
    const origPages = millsheetSelectedPages;
    millsheetPdfDoc        = botPdfDoc;
    millsheetFile          = botPdfFile;
    millsheetSelectedPages = botSelectedPages;

    try {
        let uploadResult = await doMillsheetUpload(powderName, lotNumber, false);
        if (!uploadResult.success && uploadResult.exists) {
            if (!confirm('기존 Millsheet 파일이 있습니다. 교체하시겠습니까?')) {
                millsheetPdfDoc = origDoc; millsheetFile = origFile; millsheetSelectedPages = origPages;
                return;
            }
            uploadResult = await doMillsheetUpload(powderName, lotNumber, true);
        }
        if (!uploadResult.success) {
            alert('Millsheet 업로드 실패: ' + uploadResult.message);
            millsheetPdfDoc = origDoc; millsheetFile = origFile; millsheetSelectedPages = origPages;
            return;
        }
    } catch (err) {
        alert('Millsheet 업로드 오류: ' + err.message);
        millsheetPdfDoc = origDoc; millsheetFile = origFile; millsheetSelectedPages = origPages;
        return;
    }

    millsheetPdfDoc = origDoc; millsheetFile = origFile; millsheetSelectedPages = origPages;

    // 검사 시작
    await startInspection(powderName, lotNumber, inspectionType, inspector, 'incoming', inspectionDate);

    // 서버 DB에 DriveFileId 저장 (중복 등록 방지 기준)
    await fetch(`${API_BASE}/api/bot/save-drive-file-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            powderName,
            lotNumber,
            driveFileId: botCurrentMailRow.driveFileId
        })
    });

    // 추가 LOT 여부 확인
    const more = confirm('LOT 등록이 완료되었습니다.\n\n이 PDF에 등록할 LOT가 더 있습니까?');
    if (more) {
        // 폼 초기화, PDF 유지
        document.getElementById('botPowderName').value = '';
        document.getElementById('botLotNumber').value  = '';
        botSelectedPages = [];
        document.querySelectorAll('[id^="botThumb_"]').forEach(el => {
            el.style.borderColor = '#444';
            el.style.background  = '#222';
        });
        document.querySelectorAll('[id^="botBadge_"]').forEach(el => el.style.display = 'none');
        updateBotPdfStatus();
    } else {
        closeBotRegisterModal();
        loadBotMailList();
    }
}

// 공개 링크 방식에서는 Sheets 쓰기 불필요 — DB DriveFileId 기준으로 중복 체크
function updateBotSheetStatus(rowNum, status) {
    // no-op
}

function closeBotRegisterModal() {
    document.getElementById('botRegisterModal').style.display = 'none';
    botPdfDoc        = null;
    botPdfFile       = null;
    botSelectedPages = [];
    botCurrentMailRow = null;
}
