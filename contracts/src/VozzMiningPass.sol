// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title VOZZ Mining Pass
/// @notice ERC-721 pass that unlocks mining in the VOZZ game. One mint per wallet,
///         fixed price of 0.001 ETH, forwarded straight to the payout address on every
///         mint. Artwork and metadata are generated fully on-chain.
contract VozzMiningPass is ERC721, Ownable {
    using Strings for uint256;

    uint256 public constant PRICE = 0.001 ether;

    uint256 public totalSupply;
    bool public mintOpen = true;
    address payable public payout;

    error WrongPrice();
    error AlreadyHasPass();
    error MintClosed();
    error WithdrawFailed();
    error PayoutFailed();
    error ZeroAddress();

    event MintOpenSet(bool open);
    event Withdrawn(address indexed to, uint256 amount);
    event PayoutSet(address indexed payout);

    constructor(address initialOwner, address payable payout_) ERC721("VOZZ Mining Pass", "VOZZPASS") Ownable(initialOwner) {
        _setPayout(payout_);
    }

    /// @notice Mint one Mining Pass to the caller for exactly 0.001 ETH.
    function mint() external payable returns (uint256 tokenId) {
        if (!mintOpen) revert MintClosed();
        if (msg.value != PRICE) revert WrongPrice();
        if (balanceOf(msg.sender) != 0) revert AlreadyHasPass();

        tokenId = ++totalSupply;
        _mint(msg.sender, tokenId);

        (bool ok, ) = payout.call{value: msg.value}("");
        if (!ok) revert PayoutFailed();
    }

    /// @notice True when `account` currently holds at least one pass.
    function hasPass(address account) external view returns (bool) {
        return balanceOf(account) != 0;
    }

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpenSet(open);
    }

    /// @notice Change where mint payments are sent.
    function setPayout(address payable newPayout) external onlyOwner {
        _setPayout(newPayout);
    }

    function _setPayout(address payable newPayout) private {
        if (newPayout == address(0)) revert ZeroAddress();
        payout = newPayout;
        emit PayoutSet(newPayout);
    }

    /// @notice Recover any ETH left in the contract (mints forward payment immediately,
    ///         so this is only for ETH sent here some other way).
    function withdraw(address payable to) external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory id = tokenId.toString();
        string memory json = string.concat(
            '{"name":"VOZZ Mining Pass #', id,
            '","description":"Unlocks mining in VOZZ, the GPU mining game on Robinhood Chain.",',
            '"attributes":[{"trait_type":"Type","value":"Mining Pass"}],',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(_svg(id))), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _svg(string memory id) private pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0" stop-color="#00ffaa"/><stop offset=".55" stop-color="#00d4ff"/><stop offset="1" stop-color="#7a5cff"/>',
            '</linearGradient></defs>',
            '<rect width="400" height="400" fill="#05070d"/>',
            '<path d="M200 70 290 122v104l-90 52-90-52V122Z" fill="#070c16" stroke="url(#g)" stroke-width="10" stroke-linejoin="round"/>',
            '<path d="M140 125h30l30 65 30-65h30l-50 108h-20Z" fill="#00ffaa"/>',
            '<path d="M200 95l17 10v20l-17 10-17-10v-20Z" fill="#eafff7"/>',
            '<text x="200" y="325" text-anchor="middle" font-family="monospace" font-size="22" font-weight="700" fill="#e6f1ff">MINING PASS</text>',
            '<text x="200" y="358" text-anchor="middle" font-family="monospace" font-size="18" fill="#00ffaa">#', id, '</text>',
            '</svg>'
        );
    }
}
