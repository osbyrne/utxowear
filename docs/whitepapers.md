# Add a whitepaper download to a product

## Host the PDF

Keep a copy of each PDF in storage you control. Choose one of these methods.

### Upload PDFs independently with Cloudflare R2

1. Create an R2 bucket named `utxowear-whitepapers` in the Cloudflare dashboard.
2. Connect a public custom domain such as `whitepapers.utxowear.com` to the bucket.
   Use the [R2 public bucket instructions](https://developers.cloudflare.com/r2/buckets/public-buckets/).
   Cloudflare reserves `r2.dev` URLs for development.
3. Upload the PDF with a stable filename, such as `bitcoin.pdf`.
4. Set the object's HTTP metadata to `Content-Type: application/pdf` and
   `Content-Disposition: attachment; filename="bitcoin.pdf"`.
5. Open `https://whitepapers.utxowear.com/bitcoin.pdf` in a private browser window.
   Confirm that the file downloads without authentication.

The object needs the attachment header because browsers can ignore an HTML
`download` attribute for files on another origin. The storefront links directly
to the PDF, so this method requires no Worker binding or application secret.

### Deploy PDFs with the website

1. Create `public/whitepapers/` in this repository.
2. Copy the PDF into that directory, for example `public/whitepapers/bitcoin.pdf`.
3. Deploy the website using the existing deployment procedure.
4. Open `https://utxowear.com/whitepapers/bitcoin.pdf` and confirm that the file downloads.

The PDF is served from `/whitepapers/bitcoin.pdf`. The committed `public/_headers`
file applies PDF and attachment headers to `/whitepapers/*` through
[Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/headers/).
Each new PDF requires another website deployment with this method.

## Link the PDF in Printify

1. Edit the product description in Printify.
2. Add a separate line or paragraph containing the PDF URL:

   ```text
   Whitepaper: https://whitepapers.utxowear.com/bitcoin.pdf
   ```

   For PDFs deployed with the website, use this instead:

   ```text
   Whitepaper: /whitepapers/bitcoin.pdf
   ```

3. Keep the URL as the visible text if Printify converts it to a hyperlink.
4. Publish the updated description to the sales channel used by the storefront.
5. Open the product page and select **Download whitepaper**.

The storefront removes the valid `Whitepaper:` line from the displayed
description and uses its URL for the button. Use one line per product. The
button appears only on product pages with a valid whitepaper URL, including
products unavailable for purchase. Products without metadata keep their current
appearance.

URLs must use HTTPS and have a path ending in `.pdf`, or refer to a PDF under
`/whitepapers/`. Google Drive sharing pages are not direct PDF URLs. Use a stable
public URL instead of an expiring signed link. The storefront validates the URL
format but does not check whether the file exists or contains a PDF.
