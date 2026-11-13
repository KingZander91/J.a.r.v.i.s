import { useEffect, useState } from 'react';
import {
  Copy,
  Download,
  Eye,
  FileCode2,
  FileJson,
  FileText,
  Globe2,
  Loader2,
  RotateCw,
  Trash2,
} from 'lucide-react';
import type { Artifact } from '../../shared/types';
import { api } from '../lib/api';
import {
  artifactExtension,
  cn,
  downloadText,
  formatBytes,
  formatDate,
  safeFilename,
} from '../lib/utils';
import { useAppStore } from '../store/useAppStore';
import { Markdown } from './Markdown';
import { Modal } from './Modal';

function artifactIcon(type: Artifact['type']) {
  if (type === 'code') return <FileCode2 size={18} />;
  if (type === 'json') return <FileJson size={18} />;
  if (type === 'html') return <Globe2 size={18} />;
  return <FileText size={18} />;
}

function mimeFor(type: Artifact['type']): string {
  if (type === 'markdown') return 'text/markdown';
  if (type === 'html') return 'text/html';
  if (type === 'json') return 'application/json';
  return 'text/plain';
}

export function ArtifactModal() {
  const artifactId = useAppStore((state) => state.ui.artifactId);
  const metadata = useAppStore((state) =>
    state.artifacts.find((item) => item.id === state.ui.artifactId),
  );
  const closeArtifact = useAppStore((state) => state.closeArtifact);
  const deleteArtifact = useAppStore((state) => state.deleteArtifact);
  const askConfirm = useAppStore((state) => state.askConfirm);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [htmlView, setHtmlView] = useState<'preview' | 'source'>('preview');
  const [copied, setCopied] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { artifact: loaded } = await api.getArtifact(id);
      setArtifact(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Artifact could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!artifactId) {
      setArtifact(null);
      setError(null);
      return;
    }
    setCopied(false);
    setHtmlView('preview');
    setArtifact(null);
    void load(artifactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId]);

  if (!artifactId) return null;

  const title = artifact?.title ?? metadata?.title ?? 'Artifact';
  const type = artifact?.type ?? metadata?.type ?? 'text';
  const language = artifact?.language ?? metadata?.language;
  const extension = artifactExtension(type, language);
  const filename = `${safeFilename(title)}.${extension}`;

  const copy = () => {
    if (!artifact) return;
    void navigator.clipboard?.writeText(artifact.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  const download = () => {
    if (!artifact) return;
    downloadText(filename, artifact.content, mimeFor(type));
  };

  const handleDelete = () => {
    if (!artifact) return;
    askConfirm({
      title: 'Purge artifact?',
      message: `“${artifact.title}” will be permanently deleted from local storage.`,
      confirmLabel: 'Purge artifact',
      danger: true,
      onConfirm: async () => {
        await deleteArtifact(artifact.id);
        closeArtifact();
      },
    });
  };

  const body = () => {
    if (loading) {
      return (
        <div className="artifact-loading">
          <Loader2 size={22} className="spin" />
          <span className="eyebrow">Retrieving artifact</span>
        </div>
      );
    }
    if (error) {
      return (
        <div className="artifact-loading">
          <FileText size={24} />
          <p>{error}</p>
          <button className="btn btn--ghost btn--small" onClick={() => void load(artifactId)}>
            <RotateCw size={13} /> Retry
          </button>
        </div>
      );
    }
    if (!artifact) return null;

    if (type === 'markdown') {
      return (
        <div className="artifact-document">
          <Markdown content={artifact.content} />
        </div>
      );
    }
    if (type === 'code') {
      return (
        <div className="artifact-document artifact-document--code">
          <Markdown content={`\`\`\`${language ?? ''}\n${artifact.content}\n\`\`\``} />
        </div>
      );
    }
    if (type === 'json') {
      let pretty = artifact.content;
      try {
        pretty = JSON.stringify(JSON.parse(artifact.content), null, 2);
      } catch {
        /* keep raw */
      }
      return (
        <div className="artifact-document artifact-document--code">
          <Markdown content={`\`\`\`json\n${pretty}\n\`\`\``} />
        </div>
      );
    }
    if (type === 'html') {
      return (
        <div className="artifact-html">
          <div className="segmented artifact-html__toggle">
            <button
              className={htmlView === 'preview' ? 'is-active' : ''}
              onClick={() => setHtmlView('preview')}
            >
              <Eye size={12} /> Preview
            </button>
            <button
              className={htmlView === 'source' ? 'is-active' : ''}
              onClick={() => setHtmlView('source')}
            >
              <FileCode2 size={12} /> Source
            </button>
          </div>
          {htmlView === 'preview' ? (
            <iframe
              className="artifact-frame"
              title={`${artifact.title} preview`}
              sandbox=""
              srcDoc={artifact.content}
            />
          ) : (
            <pre className="artifact-text">{artifact.content}</pre>
          )}
        </div>
      );
    }
    return <pre className="artifact-text">{artifact.content}</pre>;
  };

  return (
    <Modal
      open
      onClose={closeArtifact}
      title={title}
      eyebrow="Artifact viewer"
      icon={<span className="artifact-icon">{artifactIcon(type)}</span>}
      subtitle={
        <span className="artifact-subtitle">
          <span>{type.toUpperCase()}</span>
          {language && <span>{language}</span>}
          {metadata && <span>{formatBytes(metadata.size)}</span>}
          {metadata && <span>{formatDate(metadata.createdAt)}</span>}
          <span className="mono">ID {artifactId.slice(-8).toUpperCase()}</span>
        </span>
      }
      width={1000}
      className="modal--artifact"
      bodyClassName="artifact-body"
      footer={
        <>
          <button
            className="btn btn--danger btn--ghost-danger"
            onClick={handleDelete}
            disabled={!artifact}
          >
            <Trash2 size={13} /> Purge
          </button>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={copy} disabled={!artifact}>
              <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn--primary" onClick={download} disabled={!artifact}>
              <Download size={13} /> Download
            </button>
          </div>
        </>
      }
    >
      {body()}
    </Modal>
  );
}
