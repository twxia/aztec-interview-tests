import { LevelUp, LevelUpChain } from 'levelup';
import { HashPath } from './hash_path';
import { Sha256Hasher } from './sha256_hasher';

const MAX_DEPTH = 32;
const LEAF_BYTES = 64; // All leaf values are 64 bytes.

/**
 * The merkle tree, in summary, is a data structure with a number of indexable elements, and the property
 * that it is possible to provide a succinct proof (HashPath) that a given piece of data, exists at a certain index,
 * for a given merkle tree root.
 */
export class MerkleTree {
  private hasher = new Sha256Hasher();
  private root = Buffer.alloc(32);

  /**
   * Constructs a new MerkleTree instance, either initializing an empty tree, or restoring pre-existing state values.
   * Use the async static `new` function to construct.
   *
   * @param db Underlying leveldb.
   * @param name Name of the tree, to be used when restoring/persisting state.
   * @param depth The depth of the tree, to be no greater than MAX_DEPTH.
   * @param root When restoring, you need to provide the root.
   */
  constructor(private db: LevelUp, private name: string, private depth: number, root?: Buffer) {
    if (!(depth >= 1 && depth <= MAX_DEPTH)) {
      throw Error('Bad depth');
    }

    // Implement.
    if (!root) {
      let hash = this.hasher.hash(Buffer.alloc(LEAF_BYTES));
      for (let i = 0; i < depth; i++) {
        const parent = this.hasher.compress(hash, hash);
        this.db.put(parent, Buffer.concat([hash, hash]));
        hash = parent;
      }
      this.root = hash;
    } else {
      this.root = root;
    }
  }

  /**
   * Constructs or restores a new MerkleTree instance with the given `name` and `depth`.
   * The `db` contains the tree data.
   */
  static async new(db: LevelUp, name: string, depth = MAX_DEPTH) {
    const meta: Buffer = await db.get(Buffer.from(name)).catch(() => {});
    if (meta) {
      const root = meta.slice(0, 32);
      const depth = meta.readUInt32LE(32);
      return new MerkleTree(db, name, depth, root);
    } else {
      const tree = new MerkleTree(db, name, depth);
      await tree.writeMetaData();
      return tree;
    }
  }

  private async writeMetaData(batch?: LevelUpChain<string, Buffer>) {
    const data = Buffer.alloc(40);
    this.root.copy(data);
    data.writeUInt32LE(this.depth, 32);
    if (batch) {
      batch.put(this.name, data);
    } else {
      await this.db.put(this.name, data);
    }
  }

  getRoot() {
    return this.root;
  }

  /**
   * Returns the hash path for `index`.
   * e.g. To return the HashPath for index 2, return the nodes marked `*` at each layer.
   *     d0:                                            [ root ]
   *     d1:                      [*]0                                               [*]
   *     d2:         [*]0                      [*]1                       [ ]                     [ ]
   *     d3:   [ ]0         [ ]1          [*]0         [*]1           [ ]         [ ]          [ ]        [ ]
   *    index   0           001           010            011
   */
  async getHashPath(index: number) {
    // Implement.
    let nodes = (await this.db.get(this.root)) as Buffer;
    const hashPath = new HashPath();
    for (let i = this.depth - 1; i >= 0; i--) {
      let leftNode = nodes.slice(0, 32);
      let rightNode = nodes.slice(32, 64);
      hashPath.data[i] = [leftNode, rightNode];

      if (i !== 0) {
        const root = this.isRight(index, this.depth - 1 - i) ? rightNode : leftNode;
        nodes = await this.db.get(root);
      }
    }

    return hashPath;
  }

  /**
   * Updates the tree with `value` at `index`. Returns the new tree root.
   */
  async updateElement(index: number, value: Buffer) {
    // Implement.

    const batch = this.db.batch();
    this.root = await this._updateElement(this.root, 0, index, value, batch);
    await batch.write();
    await this.writeMetaData();

    return this.root;
  }

  isRight(index: number, currentDepth: number) {
    return !!((index >> (this.depth - currentDepth - 1)) & 1);
  }

  private async _updateElement(
    parent: Buffer,
    currentDepth: number,
    index: number,
    value: Buffer,
    batch: LevelUpChain<Buffer, Buffer>,
  ) {
    if (currentDepth === this.depth) {
      return this.hasher.hash(value);
    }
    const nodes = (await this.db.get(parent)) as Buffer;
    let leftNode = nodes.slice(0, 32);
    let rightNode = nodes.slice(32, 64);
    const isRight = this.isRight(index, currentDepth);
    const latestNode = await this._updateElement(isRight ? rightNode : leftNode, currentDepth + 1, index, value, batch);
    if (isRight) {
      rightNode = latestNode;
    } else {
      leftNode = latestNode;
    }
    const latestParent = this.hasher.compress(leftNode, rightNode);
    batch.put(latestParent, Buffer.concat([leftNode, rightNode]));

    return latestParent;
  }
}
