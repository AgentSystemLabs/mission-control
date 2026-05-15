import { SettingsSection } from "./SettingsParts";

const PARAGRAPH: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  lineHeight: 1.7,
  color: "var(--text)",
  margin: "0 0 12px",
};

const HEADING: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--text)",
  margin: "20px 0 8px",
};

const LAST_UPDATED = "May 14, 2026";

export function TermsSettingsPage() {
  return (
    <SettingsSection
      title="Terms of Service"
      headingLevel="h1"
      subtitle={`Last updated: ${LAST_UPDATED}`}
    >
      <div>
        <p style={PARAGRAPH}>
          By installing, accessing, or using Mission Control (the
          &ldquo;Software&rdquo;), you agree to be bound by these Terms of
          Service. If you do not agree, do not use the Software.
        </p>

        <h3 style={HEADING}>1. Nature of the Software</h3>
        <p style={PARAGRAPH}>
          Mission Control is a local orchestration tool that lets you launch,
          coordinate, and interact with autonomous and semi-autonomous
          third-party AI agents, command-line tools, scripts, and processes
          (&ldquo;Agents&rdquo;) on your own machine, in your own working
          directories, and against your own source code and accounts. Mission
          Control itself does not author, control, supervise, or guarantee the
          output, behavior, or safety of any Agent. You are solely responsible
          for selecting which Agents to run, what permissions to grant them,
          and what work to entrust to them.
        </p>

        <h3 style={HEADING}>2. Your Responsibility for Agent Actions</h3>
        <p style={PARAGRAPH}>
          Agents you run through Mission Control may read, write, modify, or
          delete files; execute shell commands; commit and push code; call
          external APIs; spend money on paid services; and otherwise take
          actions with real-world consequences. You acknowledge and agree
          that:
        </p>
        <p style={PARAGRAPH}>
          (a) every action taken by an Agent launched from Mission Control is
          your action and your responsibility; (b) you are responsible for
          reviewing, approving, and verifying anything an Agent produces or
          changes before relying on it; (c) you are responsible for
          maintaining your own backups, version control, and recovery
          procedures; and (d) you are responsible for ensuring your use of
          Agents complies with all applicable laws, contracts, licenses, and
          third-party terms of service.
        </p>

        <h3 style={HEADING}>3. No Warranty</h3>
        <p style={PARAGRAPH}>
          THE SOFTWARE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
          AVAILABLE,&rdquo; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
          INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS
          FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY,
          RELIABILITY, OR UNINTERRUPTED OPERATION. NO ADVICE OR INFORMATION,
          WHETHER ORAL OR WRITTEN, OBTAINED THROUGH THE SOFTWARE CREATES ANY
          WARRANTY NOT EXPRESSLY STATED IN THESE TERMS.
        </p>

        <h3 style={HEADING}>4. Limitation of Liability</h3>
        <p style={PARAGRAPH}>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL
          THE AUTHOR, COPYRIGHT HOLDER, OR ANY CONTRIBUTOR TO MISSION CONTROL
          BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
          CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING WITHOUT
          LIMITATION DAMAGES FOR LOST PROFITS, LOST DATA, CORRUPTED FILES,
          DAMAGED OR DELETED CODE, BROKEN BUILDS, UNINTENDED COMMITS OR
          PUSHES, UNINTENDED API SPEND, BUSINESS INTERRUPTION, REPUTATIONAL
          HARM, OR ANY OTHER LOSS ARISING OUT OF OR IN CONNECTION WITH YOUR
          USE OF THE SOFTWARE OR THE BEHAVIOR OF ANY AGENT YOU RUN THROUGH
          IT, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES, AND
          REGARDLESS OF THE THEORY OF LIABILITY (CONTRACT, TORT, NEGLIGENCE,
          STRICT LIABILITY, OR OTHERWISE).
        </p>
        <p style={PARAGRAPH}>
          Without limiting the foregoing, the Software&apos;s aggregate
          liability to you for any and all claims arising from or related to
          the Software shall not exceed the greater of (a) the amount you
          actually paid for the Software in the twelve (12) months preceding
          the event giving rise to the claim, or (b) US $50.
        </p>

        <h3 style={HEADING}>5. Indemnification</h3>
        <p style={PARAGRAPH}>
          You agree to defend, indemnify, and hold harmless the author,
          copyright holders, and contributors of Mission Control from and
          against any and all claims, damages, losses, liabilities, costs,
          and expenses (including reasonable attorneys&apos; fees) arising out
          of or related to (a) your use of the Software; (b) any action taken
          by an Agent you launched, configured, or authorized through the
          Software; (c) your violation of these Terms; or (d) your violation
          of any third party&apos;s rights, including any intellectual
          property, privacy, or contractual right.
        </p>

        <h3 style={HEADING}>6. Third-Party Tools and Services</h3>
        <p style={PARAGRAPH}>
          Mission Control integrates with third-party Agents, models, APIs,
          and tools that are governed by their own terms and pricing. Mission
          Control is not responsible for those services, their availability,
          their output, or any charges they incur on your behalf. You are
          responsible for reviewing and complying with the terms of any
          third-party service you use through the Software.
        </p>

        <h3 style={HEADING}>7. Acceptable Use</h3>
        <p style={PARAGRAPH}>
          You agree not to use the Software to (a) violate any law or
          regulation; (b) infringe any third party&apos;s intellectual
          property, privacy, or contractual rights; (c) generate or
          distribute malicious code, malware, or content intended to harm
          others; or (d) take actions against systems, accounts, or data you
          are not authorized to access.
        </p>

        <h3 style={HEADING}>8. Changes to These Terms</h3>
        <p style={PARAGRAPH}>
          These Terms may be updated from time to time. Continued use of the
          Software after an updated version is published constitutes
          acceptance of the updated Terms. You can always review the current
          version from this Settings panel.
        </p>

        <h3 style={HEADING}>9. Severability</h3>
        <p style={PARAGRAPH}>
          If any provision of these Terms is held to be unenforceable, that
          provision shall be modified to the minimum extent necessary to make
          it enforceable, and the remaining provisions shall remain in full
          force and effect.
        </p>

        <h3 style={HEADING}>10. Entire Agreement</h3>
        <p style={PARAGRAPH}>
          These Terms constitute the entire agreement between you and the
          author regarding the Software and supersede any prior agreements or
          understandings related to the same subject matter.
        </p>
      </div>
    </SettingsSection>
  );
}
