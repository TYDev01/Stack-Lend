(define-constant STATUS-OPEN u0)
(define-constant STATUS-FUNDED u1)
(define-constant STATUS-REPAID u2)
(define-constant STATUS-DEFAULTED u3)
(define-constant STATUS-CANCELLED u4)

(define-constant ERR-LOAN-EXISTS u100)
(define-constant ERR-LOAN-NOT-FOUND u101)
(define-constant ERR-NOT-BORROWER u102)
(define-constant ERR-NOT-LENDER u103)
(define-constant ERR-NOT-OPEN u104)
(define-constant ERR-NOT-FUNDED u105)
(define-constant ERR-PAST-DUE u106)
(define-constant ERR-NOT-PAST-DUE u107)
(define-constant ERR-BAD-AMOUNT u108)
(define-constant ERR-SAME-ASSET u109)
(define-constant ERR-NO-LENDER u110)
(define-constant ERR-BAD-REPAY u111)

(define-constant TOKEN-CONTRACT .sbtc-token)

(define-map loans
  {loan-id: uint}
  {
    borrower: principal,
    lender: (optional principal),
    principal-is-stx: bool,
    principal-amount: uint,
    collateral-is-stx: bool,
    collateral-amount: uint,
    repay-amount: uint,
    start-block: uint,
    end-block: uint,
    status: uint
  }
)

(define-private (contract-self)
  (as-contract tx-sender)
)

(define-private (transfer-asset (is-stx bool) (amount uint) (sender principal) (recipient principal))
  (if is-stx
      (stx-transfer? amount sender recipient)
      (contract-call? TOKEN-CONTRACT transfer amount sender recipient none)
  )
)

(define-read-only (get-loan (loan-id uint))
  (map-get? loans {loan-id: loan-id})
)

(define-public (create-loan
  (loan-id uint)
  (principal-is-stx bool)
  (principal-amount uint)
  (repay-amount uint)
  (duration uint)
  (collateral-is-stx bool)
  (collateral-amount uint)
)
  (begin
    (asserts! (is-none (map-get? loans {loan-id: loan-id})) (err ERR-LOAN-EXISTS))
    (asserts! (not (is-eq principal-is-stx collateral-is-stx)) (err ERR-SAME-ASSET))
    (asserts! (> principal-amount u0) (err ERR-BAD-AMOUNT))
    (asserts! (> collateral-amount u0) (err ERR-BAD-AMOUNT))
    (asserts! (> duration u0) (err ERR-BAD-AMOUNT))
    (asserts! (>= repay-amount principal-amount) (err ERR-BAD-REPAY))
    (try! (transfer-asset collateral-is-stx collateral-amount tx-sender (contract-self)))
    (map-set loans
      {loan-id: loan-id}
      {
        borrower: tx-sender,
        lender: none,
        principal-is-stx: principal-is-stx,
        principal-amount: principal-amount,
        collateral-is-stx: collateral-is-stx,
        collateral-amount: collateral-amount,
        repay-amount: repay-amount,
        start-block: u0,
        end-block: duration,
        status: STATUS-OPEN
      }
    )
    (ok true)
  )
)

(define-public (cancel-loan (loan-id uint))
  (match (map-get? loans {loan-id: loan-id})
    loan
    (begin
      (asserts! (is-eq (get status loan) STATUS-OPEN) (err ERR-NOT-OPEN))
      (asserts! (is-eq tx-sender (get borrower loan)) (err ERR-NOT-BORROWER))
      (try! (transfer-asset (get collateral-is-stx loan) (get collateral-amount loan) (contract-self) (get borrower loan)))
      (map-set loans
        {loan-id: loan-id}
        (merge loan {status: STATUS-CANCELLED})
      )
      (ok true)
    )
    (err ERR-LOAN-NOT-FOUND)
  )
)

(define-public (fund-loan (loan-id uint))
  (match (map-get? loans {loan-id: loan-id})
    loan
    (begin
      (asserts! (is-eq (get status loan) STATUS-OPEN) (err ERR-NOT-OPEN))
      (try! (transfer-asset (get principal-is-stx loan) (get principal-amount loan) tx-sender (contract-self)))
      (try! (transfer-asset (get principal-is-stx loan) (get principal-amount loan) (contract-self) (get borrower loan)))
      (map-set loans
        {loan-id: loan-id}
        (merge loan {
          lender: (some tx-sender),
          start-block: block-height,
          end-block: (+ block-height (get end-block loan)),
          status: STATUS-FUNDED
        })
      )
      (ok true)
    )
    (err ERR-LOAN-NOT-FOUND)
  )
)

(define-public (repay (loan-id uint))
  (match (map-get? loans {loan-id: loan-id})
    loan
    (begin
      (asserts! (is-eq (get status loan) STATUS-FUNDED) (err ERR-NOT-FUNDED))
      (asserts! (is-eq tx-sender (get borrower loan)) (err ERR-NOT-BORROWER))
      (asserts! (<= block-height (get end-block loan)) (err ERR-PAST-DUE))
      (let ((lender (unwrap! (get lender loan) (err ERR-NO-LENDER))))
        (try! (transfer-asset (get principal-is-stx loan) (get repay-amount loan) tx-sender lender))
        (try! (transfer-asset (get collateral-is-stx loan) (get collateral-amount loan) (contract-self) (get borrower loan)))
        (map-set loans
          {loan-id: loan-id}
          (merge loan {status: STATUS-REPAID})
        )
        (ok true)
      )
    )
    (err ERR-LOAN-NOT-FOUND)
  )
)

(define-public (claim-default (loan-id uint))
  (match (map-get? loans {loan-id: loan-id})
    loan
    (begin
      (asserts! (is-eq (get status loan) STATUS-FUNDED) (err ERR-NOT-FUNDED))
      (asserts! (> block-height (get end-block loan)) (err ERR-NOT-PAST-DUE))
      (let ((lender (unwrap! (get lender loan) (err ERR-NO-LENDER))))
        (asserts! (is-eq tx-sender lender) (err ERR-NOT-LENDER))
        (try! (transfer-asset (get collateral-is-stx loan) (get collateral-amount loan) (contract-self) lender))
        (map-set loans
          {loan-id: loan-id}
          (merge loan {status: STATUS-DEFAULTED})
        )
        (ok true)
      )
    )
    (err ERR-LOAN-NOT-FOUND)
  )
)
