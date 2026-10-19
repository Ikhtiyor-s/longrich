import { IsInt, IsOptional, Min } from 'class-validator';

// Omitting contract_version accepts the platform's current contract version
// (ApplicationsService.CURRENT_SELLER_CONTRACT_VERSION) — real e-sign/vendor
// integration and a legally-reviewed contract-version process are explicitly
// future/open (TZ §06 SEL-004 "where applicable"; docs/open-questions.md
// #12), so this stays a plain integer, not a vendor-specific payload shape.
export class AcceptContractDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  contract_version?: number;
}
