// Gmail Bot: 화이트리스트 메일 수신 시 Drive 저장 + Sheets 기록
// Last updated: 2026-05-18
// 수정이력:
//   2026-05-18 - Whitelist 시트 null 체크 추가
//   2026-05-18 - PDF 판별 시 MIME 타입 외 파일 확장자(.pdf) 병행 확인 추가

const DRIVE_FOLDER_ID = '1kFF1qnqUSs1ZaK-IkD5IjK7osY3mjF2T';
const SPREADSHEET_ID  = '1A1VA6VcNq3GIuS1CLmKkgLOyhYexOHlwRP2dSJZV8RU';
const SHEET_NAME      = 'MailLog';
const WHITELIST_SHEET = 'Whitelist';

// ── Whitelist 시트에서 업체 목록 읽기 ────────────────────────
function getWhitelist() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(WHITELIST_SHEET);

  // [수정] Whitelist 시트 없을 경우 에러 방지
  if (!sheet) {
    Logger.log(`[오류] "${WHITELIST_SHEET}" 시트를 찾을 수 없습니다. 시트 이름을 확인하세요.`);
    return {};
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const data      = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const whitelist = {};
  data.forEach(row => {
    const email   = row[0].toString().trim().toLowerCase();
    const company = row[1].toString().trim();
    if (email && company) whitelist[email] = company;
  });
  return whitelist;
}

// ── 메일 수신 처리 (15분마다 실행) ──────────────────────────
function checkNewMails() {
  const WHITELIST = getWhitelist();
  if (Object.keys(WHITELIST).length === 0) {
    Logger.log('Whitelist가 비어있습니다. Whitelist 시트를 확인하세요.');
    return;
  }

  const ss        = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet     = ss.getSheetByName(SHEET_NAME);
  const labelName = 'MailBot/Processed';

  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) label = GmailApp.createLabel(labelName);

  const senderList = Object.keys(WHITELIST);
  const query      = `(${senderList.map(e => `from:${e}`).join(' OR ')}) has:attachment -label:${labelName}`;
  const threads    = GmailApp.search(query, 0, 50);

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const from        = message.getFrom();
      const senderEmail = (from.match(/<(.+)>/)?.[1] || from).toLowerCase();
      const companyName = WHITELIST[senderEmail];
      if (!companyName) return;

      // MIME 타입이 application/pdf가 아니더라도 확장자가 .pdf면 PDF로 처리
      // (일부 해외 메일 시스템이 PDF를 application/octet-stream 등으로 전송하는 경우 대응)
      const pdfFiles = message.getAttachments({ includeInlineImages: false })
                              .filter(a => a.getContentType() === 'application/pdf' ||
                                          a.getName().toLowerCase().endsWith('.pdf'));
      if (pdfFiles.length === 0) return;

      // 업체별 하위 폴더 확인 또는 생성
      const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
      const existing     = parentFolder.getFoldersByName(companyName);
      const subFolder    = existing.hasNext() ? existing.next() : parentFolder.createFolder(companyName);

      const receivedDate = Utilities.formatDate(message.getDate(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
      const mailId       = message.getId();

      pdfFiles.forEach(pdf => {
        // Drive에 저장
        const file        = subFolder.createFile(pdf);
        const driveFileId = file.getId();

        // 공개 공유 설정 (로그인 없이 링크로 접근 가능)
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        // Sheets에 행 추가
        // 컬럼: A=RowIndex, B=메일ID, C=업체명, D=수신일시, E=제목, F=파일명, G=DriveFileId, H=등록여부, I=수신날짜(삭제기준)
        const lastRow = sheet.getLastRow() + 1;
        sheet.getRange(lastRow, 1, 1, 9).setValues([[
          lastRow,
          mailId,
          companyName,
          receivedDate,
          message.getSubject(),
          pdf.getName(),
          driveFileId,
          '미등록',
          new Date()  // 삭제 기준 날짜 (I열)
        ]]);
      });
    });

    // 처리 완료 라벨 부착 (중복 처리 방지)
    thread.addLabel(label);
  });
}

// ── 매일 새벽 실행: 30일 경과 데이터 삭제 ───────────────────
// [참고] 이 함수는 MailLog 시트만 정리합니다. Whitelist 시트는 건드리지 않습니다.
function dailyCleanup() {
  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet   = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data    = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  const now     = new Date();
  let   deleted = 0;

  // 뒤에서부터 삭제 (행 인덱스 밀림 방지)
  for (let i = data.length - 1; i >= 0; i--) {
    const receivedDate = data[i][8]; // I열: 수신날짜
    if (!receivedDate) continue;

    const diffDays = (now - new Date(receivedDate)) / (1000 * 60 * 60 * 24);
    if (diffDays < 30) continue;

    // 30일 경과 → 등록여부 관계없이 삭제
    const driveFileId = data[i][6]; // G열: DriveFileId
    try {
      DriveApp.getFileById(driveFileId).setTrashed(true);
    } catch (e) {
      Logger.log(`Drive 파일 삭제 실패 (이미 없을 수 있음): ${driveFileId}`);
    }

    sheet.deleteRow(i + 2);
    deleted++;
  }

  Logger.log(`일간 정리 완료: ${deleted}건 삭제`);
}
