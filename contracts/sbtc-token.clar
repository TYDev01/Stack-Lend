(define-fungible-token sbtc)

(define-constant ERR-NOT-OWNER u200)
(define-constant ERR-UNAUTHORIZED u201)

(define-data-var owner principal tx-sender)
(define-data-var total-supply uint u0)

(define-read-only (get-name)
  (ok "sBTC")
)

(define-read-only (get-symbol)
  (ok "sBTC")
)

(define-read-only (get-decimals)
  (ok u8)
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
)

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance sbtc who))
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-OWNER))
    (try! (ft-mint? sbtc amount recipient))
    (var-set total-supply (+ (var-get total-supply) amount))
    (ok true)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) (err ERR-UNAUTHORIZED))
    (try! (ft-transfer? sbtc amount sender recipient))
    (ok true)
  )
)
